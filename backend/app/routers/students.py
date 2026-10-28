"""Admission (enquiry -> student), student list/profile, edit, status, archive, change time slot, Aadhaar reveal."""
import re
from datetime import date
from decimal import ROUND_FLOOR, Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..common import (
    ZERO, In, Mobile, Money, OptAadhaar, OptEmail, OptMobile, OptStr, OptText, Paging, PayMode, Reason, Str, aadhaar_columns,
    aadhaar_decrypt, aadhaar_hash, aadhaar_mask, add_months_clamped, apply_changes, audit, like, money, next_code, now, paginate,
    paging, today, user_names, user_ref,
)
from ..db import get_db
from ..errors import AppError, bad, conflict, not_found
from ..ledger import INSTALLMENT_NO_OFFSET, fee_cols, fee_summary, pct
from ..models import (
    CourseSubtype, Enquiry, EnquiryActivity, FeeReceipt, FeeReminderEvent, AuditLog, Student, StudentInstallment, StudentPayment,
    StudentTimeSlotHistory, TimeSlot,
)
from ..security import CurrentUser, require, require_admin
from .academics import fmt_time, get_course, slot_status
from .fees import payment_out, receipt_out, record_payment

router = APIRouter(tags=["students"])


# ----------------------------------------------------------------- schedule (mirror of admitStudent in src/data/store.ts)


def build_schedule(net: Decimal, paid_now: Decimal, count: int, first_due: date | None, admission: date) -> list[tuple[int, date, Decimal]]:
    """Row 0 = admission payment; rows 1..n split the rest in multiples of 50, last row takes the remainder.

    ponytail: mirrors the demo exactly, including its edge case: when rest < 50*n every row but the last is 0.
    """
    rest = net - paid_now
    rows = [(0, admission, paid_now)]
    per = (rest / count / 50).to_integral_value(ROUND_FLOOR) * 50 if count else ZERO
    for k in range(1, count + 1):
        rows.append((k, add_months_clamped(first_due, k - 1), rest - per * (count - 1) if k == count else per))
    return rows


# ----------------------------------------------------------------- admission


class AdmissionIn(In):
    full_name: Str(160, 3)
    guardian_name: Str(160)
    dob: date
    gender: Literal["Male", "Female"]
    mobile: Mobile
    whatsapp_number: OptMobile = None  # omitted -> same as mobile
    email: OptEmail = None
    address: Str(2000)
    aadhaar: OptAadhaar = None  # omitted -> keep the enquiry's Aadhaar
    education_qualification: OptStr(200) = None
    remark: OptText = None
    course_id: int
    course_subtype_id: int | None = None
    time_slot_id: int
    discount: Money = ZERO
    paid_now: Money = ZERO
    payment_mode: PayMode | None = None
    payment_reference: OptStr(150) = None
    installment_count: int = Field(0, ge=0, le=8)
    first_due_date: date | None = None

    @model_validator(mode="after")
    def _rules(self):
        if self.dob >= today():
            raise ValueError("Date of birth must be in the past")
        if self.paid_now > 0 and not self.payment_mode:
            raise ValueError("Payment mode is required when an amount is paid now")
        return self


def check_course_choice(db: Session, course_id: int | None, subtype_id: int | None):
    if subtype_id and not course_id:
        raise bad("SUBTYPE_WITHOUT_COURSE", "Choose a course before a sub-type.", "course_subtype_id")
    if course_id:
        c = get_course(db, course_id)
        if not c.is_active:
            raise bad("COURSE_INACTIVE", "Choose an active course.", "course_id")
    if subtype_id:
        st = db.get(CourseSubtype, subtype_id)
        if st is None or st.course_id != course_id or not st.is_active:
            raise bad("SUBTYPE_MISMATCH", "Choose a sub-type of the selected course.", "course_subtype_id")


def valid_slot(db: Session, slot_id: int, course_id: int) -> TimeSlot:
    slot = db.get(TimeSlot, slot_id)
    if slot is None or slot.course_id != course_id or not slot.is_active or slot_status(slot, today()) == "Completed":
        raise bad("INVALID_TIME_SLOT", "Choose a valid time slot for the course.", "time_slot_id")
    return slot


def capacity_warning(db: Session, slot: TimeSlot) -> bool:
    # Capacity is advisory (UI allows over-capacity admission); never a hard block.
    n = db.scalar(select(func.count()).where(Student.time_slot_id == slot.id, Student.status == "Active", Student.deleted_at.is_(None)))
    return n > slot.capacity


def admit(db: Session, enquiry_code: str, body: AdmissionIn, user: CurrentUser, idempotency_key: str | None = None) -> dict:
    e = db.scalars(select(Enquiry).where(Enquiry.enquiry_code == enquiry_code).with_for_update()).first()
    if e is None:
        raise not_found("enquiry")
    if e.status == "Converted" or db.scalar(select(Student.id).where(Student.enquiry_id == e.id)):
        raise conflict("ENQUIRY_ALREADY_CONVERTED", "This enquiry is already converted to a student.")
    if e.course_id and e.course_id != body.course_id:
        raise bad("COURSE_MISMATCH", "The admission course must match the enquiry course.", "course_id")
    check_course_choice(db, body.course_id, body.course_subtype_id)
    course = get_course(db, body.course_id)
    slot = valid_slot(db, body.time_slot_id, course.id)
    fee = course.fee
    if body.discount > fee:
        raise bad("DISCOUNT_EXCEEDS_FEE", "Discount can't exceed the course fee.", "discount")
    net = fee - body.discount
    if body.paid_now > net:
        raise bad("PAID_EXCEEDS_NET_FEE", f"Can't exceed net fee of {money(net)}.", "paid_now")
    rest = net - body.paid_now
    if rest > 0 and not 1 <= body.installment_count <= 8:
        raise bad("INSTALLMENTS_REQUIRED", "Choose 1 to 8 installments for the outstanding balance.", "installment_count")
    if rest == 0 and body.installment_count:
        raise bad("INSTALLMENTS_NOT_NEEDED", "No installments are needed when the full fee is paid now.", "installment_count")
    if rest > 0 and body.first_due_date is None:
        raise bad("FIRST_DUE_DATE_REQUIRED", "Choose a valid first due date.", "first_due_date")
    if body.paid_now > 0 and body.payment_mode == "Bank" and not body.payment_reference:
        raise bad("REFERENCE_REQUIRED", "Transaction / UTR reference is required for bank transfers.", "payment_reference")

    aadhaar = aadhaar_columns(body.aadhaar) if body.aadhaar else {
        "aadhaar_ciphertext": e.aadhaar_ciphertext, "aadhaar_lookup_hash": e.aadhaar_lookup_hash, "aadhaar_last4": e.aadhaar_last4}
    t = today()
    s = Student(
        student_code=next_code(db, "STUDENT"), enquiry_id=e.id, full_name=body.full_name, guardian_name=body.guardian_name, dob=body.dob,
        gender=body.gender, mobile=body.mobile, whatsapp_number=body.whatsapp_number or body.mobile, email=body.email, address=body.address,
        education_qualification=body.education_qualification, remark=body.remark, reference=e.reference, course_id=course.id,
        course_subtype_id=body.course_subtype_id, time_slot_id=slot.id, admission_date=t, status="Active", agreed_fee=fee,
        discount=body.discount, net_fee=net, created_by=user.id, **aadhaar)
    db.add(s)
    db.flush()
    for no, due, amount in build_schedule(net, body.paid_now, body.installment_count if rest > 0 else 0, body.first_due_date, t):
        db.add(StudentInstallment(student_id=s.id, installment_no=no + INSTALLMENT_NO_OFFSET, due_date=due, amount=amount, paid_amount=ZERO))
    old = e.status
    e.status, e.handling_staff_id = "Converted", user.id
    db.add(EnquiryActivity(enquiry_id=e.id, actor_id=user.id, old_status=old, new_status="Converted", note=f"Student {s.student_code} created"))
    audit(db, user.id, "ENQUIRY_CONVERTED", "Enquiry", e.enquiry_code, f"{e.enquiry_code} converted to {s.student_code}")
    audit(db, user.id, "STUDENT_CREATED", "Student", s.student_code, f"Admission confirmed - {s.full_name} ({course.code})",
          after={"net_fee": money(net), "paid_now": money(body.paid_now), "installments": body.installment_count})
    db.flush()
    db.refresh(s)
    warn = capacity_warning(db, slot)
    payment = receipt = None
    if body.paid_now > 0:
        payment, receipt = record_payment(db, s, body.paid_now, body.payment_mode, body.payment_reference, "Admission payment", user, idempotency_key)
    db.commit()
    return {"student": student_out(s), "fees": fee_summary(db, s, today()), "capacity_warning": warn,
            "payment": payment_out(payment, receipt.receipt_code, s, {user.id: user.full_name}) if payment else None,
            "receipt": receipt_out(receipt, payment) if receipt else None}


class StudentCreateIn(AdmissionIn):
    enquiry_code: Str(40)


@router.post("/students", status_code=201)
def create_student(body: StudentCreateIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=120),
                   db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.create"))):
    """Admission always starts from an enquiry (students.enquiry_id is NOT NULL UNIQUE)."""
    return admit(db, body.enquiry_code, AdmissionIn(**body.model_dump(exclude={"enquiry_code"})), user, idempotency_key)


# ----------------------------------------------------------------- read


def student_out(s: Student) -> dict:
    slot = s.time_slot
    return {
        "code": s.student_code, "full_name": s.full_name, "guardian_name": s.guardian_name, "dob": s.dob, "gender": s.gender,
        "mobile": s.mobile, "whatsapp_number": s.whatsapp_number, "email": s.email, "address": s.address,
        "aadhaar_masked": aadhaar_mask(s.aadhaar_last4), "education_qualification": s.education_qualification,
        "reference": s.reference, "remark": s.remark, "status": s.status, "admission_date": s.admission_date,
        "course": {"id": s.course.id, "code": s.course.code, "name": s.course.name,
                   "duration_months": int(s.course.duration) if (s.course.duration or "").isdigit() else None},
        "course_subtype": {"id": s.subtype.id, "name": s.subtype.name} if s.subtype else None,
        "time_slot": {"id": slot.id, "name": slot.name, "timing": f"{fmt_time(slot.start_time)} – {fmt_time(slot.end_time)}",
                      "days": slot.days_of_week, "faculty": slot.faculty_name},
        "agreed_fee": money(s.agreed_fee), "discount": money(s.discount), "net_fee": money(s.net_fee),
        "archived": s.deleted_at is not None, "created_at": s.created_at, "updated_at": s.updated_at,
    }


def get_student(db: Session, code: str, lock: bool = False, archived_ok: bool = False) -> Student:
    stmt = select(Student).where(Student.student_code == code)
    s = db.scalars(stmt.with_for_update() if lock else stmt).first()
    if s is None or (s.deleted_at is not None and not archived_ok):
        raise not_found("student")
    return s


def search_filter(q: str):
    """Name, guardian, mobile, Student ID; Aadhaar only by full 12 digits (hash) or last 4 (no plaintext is stored)."""
    conds = [Student.full_name.ilike(like(q)), Student.guardian_name.ilike(like(q)), Student.student_code.ilike(like(q))]
    digits = re.sub(r"\D", "", q)
    if digits:
        conds.append(Student.mobile.like(like(digits)))
    if len(digits) == 12:
        try:
            conds.append(Student.aadhaar_lookup_hash == aadhaar_hash(digits))
        except AppError:
            pass  # Aadhaar key not configured: search the other fields only
    elif len(digits) == 4 and digits == q.strip():
        conds.append(Student.aadhaar_last4 == digits)
    return or_(*conds)


@router.get("/students")
def list_students(q: str | None = None, course_id: int | None = None, time_slot_id: int | None = None,
                  status: Literal["Active", "Completed", "Left"] | None = None,
                  fee_status: Literal["Fully Paid", "Overdue", "Due Today", "Due Tomorrow", "On Track", "Pending"] | None = None,
                  include_archived: bool = False, p: Paging = Depends(paging), db: Session = Depends(get_db),
                  _: CurrentUser = Depends(require("students.view"))):
    t = today()
    f = fee_cols(t)
    stmt = f.join(select(Student, f.paid, f.balance, f.next_due, f.next_remaining, f.state)).options(
        joinedload(Student.course), joinedload(Student.time_slot), joinedload(Student.subtype))
    if not include_archived:
        stmt = stmt.where(Student.deleted_at.is_(None))
    if q:
        stmt = stmt.where(search_filter(q))
    if course_id:
        stmt = stmt.where(Student.course_id == course_id)
    if time_slot_id:
        stmt = stmt.where(Student.time_slot_id == time_slot_id)
    if status:
        stmt = stmt.where(Student.status == status)
    if fee_status:
        stmt = stmt.where(f.state != "Fully Paid" if fee_status == "Pending" else f.state == fee_status)
    stmt = stmt.order_by(Student.created_at.desc(), Student.id.desc())
    counts = {"total": db.scalar(select(func.count()).where(Student.deleted_at.is_(None))),
              "active": db.scalar(select(func.count()).where(Student.deleted_at.is_(None), Student.status == "Active"))}
    return paginate(db, stmt, p, lambda r: {
        "code": r[0].student_code, "full_name": r[0].full_name, "guardian_name": r[0].guardian_name, "mobile": r[0].mobile,
        "course": {"id": r[0].course.id, "code": r[0].course.code, "name": r[0].course.name},
        "time_slot": {"id": r[0].time_slot.id, "name": r[0].time_slot.name}, "admission_date": r[0].admission_date, "status": r[0].status,
        "net_fee": money(r[0].net_fee), "paid": money(r[1]), "balance": money(r[2]), "paid_pct": pct(r[1], r[0].net_fee),
        "fee_state": r[5], "next_due": {"due_date": r[3], "amount": money(r[4])} if r[3] else None,
        "aadhaar_masked": aadhaar_mask(r[0].aadhaar_last4), "archived": r[0].deleted_at is not None}, scalars=False, counts=counts)


@router.get("/students/{code}")
def get_student_api(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    return student_out(get_student(db, code, archived_ok=True))


@router.get("/students/{code}/profile")
def student_profile(code: str, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.view"))):
    s = get_student(db, code, archived_ok=True)
    rows = db.execute(select(StudentPayment, FeeReceipt).outerjoin(FeeReceipt, FeeReceipt.payment_id == StudentPayment.id)
                      .where(StudentPayment.student_id == s.id).order_by(StudentPayment.received_at.desc())).all()
    reminders = db.scalars(select(FeeReminderEvent).where(FeeReminderEvent.student_id == s.id).order_by(FeeReminderEvent.opened_at.desc())).all()
    events = db.scalars(select(AuditLog).where(AuditLog.entity_type == "Student", AuditLog.entity_id == s.student_code)).all()
    names = user_names(db, [x.collected_by for x, _ in rows] + [x.reversed_by for x, _ in rows] + [r.opened_by for r in reminders] + [a.actor_id for a in events])
    payments = [payment_out(x, r.receipt_code if r else None, s, names) for x, r in rows]
    activity = (
        [{"at": x.received_at, "type": "payment", "title": f"Fee received · {money(x.amount)} ({x.payment_mode})", "by": user_ref(names, x.collected_by),
          "ref": r.receipt_code if r else None} for x, r in rows]
        + [{"at": x.reversed_at, "type": "reversal", "title": f"Payment reversed · {money(x.amount)}", "by": user_ref(names, x.reversed_by),
            "ref": r.receipt_code if r else None, "note": x.reversal_reason} for x, r in rows if x.status == "Reversed"]
        + [{"at": e.opened_at, "type": "reminder", "title": "WhatsApp fee reminder opened", "by": user_ref(names, e.opened_by), "note": e.note} for e in reminders]
        + [{"at": a.created_at, "type": "change", "title": a.summary, "action": a.action, "by": user_ref(names, a.actor_id), "note": a.reason} for a in events]
    )
    if not user.can("fees.view"):  # QA-06: no payment amounts for users who can't see fees
        activity = [a for a in activity if a["type"] not in ("payment", "reversal")]
    activity.sort(key=lambda a: a["at"], reverse=True)
    fees = fee_summary(db, s, today()) if user.can("fees.view") else None
    last = db.scalar(select(func.max(FeeReminderEvent.opened_at)).where(FeeReminderEvent.student_id == s.id))
    return {"student": student_out(s), "fees": fees, "payments": payments[:20] if fees else [],
            "receipts": [{"receipt_no": r.receipt_code, "issued_at": r.issued_at, "amount": money(x.amount)} for x, r in rows if r and x.status == "Valid"] if fees else [],
            "last_reminded_at": last, "activity": activity}


# ----------------------------------------------------------------- edit / status / archive / time slot


class StudentPatch(In):
    full_name: Str(160, 3) | None = None
    guardian_name: Str(160) | None = None
    dob: date | None = None
    gender: Literal["Male", "Female"] | None = None
    mobile: OptMobile = None
    whatsapp_number: OptMobile = None
    email: OptEmail = None
    address: Str(2000) | None = None
    aadhaar: OptAadhaar = None
    course_subtype_id: int | None = None
    education_qualification: OptStr(200) = None
    reference: OptText = None
    remark: OptText = None


REQUIRED_ON_PATCH = {"full_name", "guardian_name", "dob", "gender", "mobile", "address"}


@router.patch("/students/{code}")
def update_student(code: str, body: StudentPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.edit"))):
    s = get_student(db, code, lock=True)
    data = body.model_dump(exclude_unset=True)
    for k in REQUIRED_ON_PATCH & data.keys():
        if data[k] is None:
            raise bad("FIELD_REQUIRED", f"{k.replace('_', ' ').capitalize()} is required.", k)
    if data.get("dob") and data["dob"] >= today():
        raise bad("INVALID_DOB", "Date of birth must be in the past.", "dob")
    if "course_subtype_id" in data:
        check_course_choice(db, s.course_id, data["course_subtype_id"])
    aadhaar_changed = "aadhaar" in data
    if aadhaar_changed:
        data.update(aadhaar_columns(data.pop("aadhaar")))
    before, after = apply_changes(s, data)
    for k in ("aadhaar_ciphertext", "aadhaar_lookup_hash", "aadhaar_last4"):  # never put Aadhaar in the audit log
        before.pop(k, None), after.pop(k, None)
    if aadhaar_changed:
        before["aadhaar"], after["aadhaar"] = "(hidden)", "changed"
    if after:
        audit(db, user.id, "STUDENT_UPDATED", "Student", s.student_code, f"Details updated for {s.full_name}", before, after)
    db.commit()
    return student_out(s)


class StatusIn(In):
    reason: OptText = None


class LeftIn(In):
    reason: Reason


def _set_status(db: Session, code: str, status: str, reason: str | None, user: CurrentUser) -> dict:
    s = get_student(db, code, lock=True)
    if s.status != "Active":
        raise conflict("INVALID_STATUS_CHANGE", f"Only Active students can be marked {status}.")
    s.status = status
    audit(db, user.id, "STUDENT_STATUS_CHANGED", "Student", s.student_code, f"{s.full_name} marked {status}",
          {"status": "Active"}, {"status": status}, reason)
    db.commit()
    return student_out(s)


@router.post("/students/{code}/mark-completed")
def mark_completed(code: str, body: StatusIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.edit"))):
    return _set_status(db, code, "Completed", body.reason, user)


@router.post("/students/{code}/mark-left")
def mark_left(code: str, body: LeftIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.edit"))):
    return _set_status(db, code, "Left", body.reason, user)


@router.post("/students/{code}/archive")
def archive_student(code: str, body: LeftIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.delete"))):
    """Soft delete: hidden from lists and dues; payments and receipts stay for audit and reports."""
    s = get_student(db, code, lock=True)
    s.deleted_at = now()
    audit(db, user.id, "STUDENT_ARCHIVED", "Student", s.student_code, f"{s.full_name} moved to Deleted History", reason=body.reason)
    db.commit()
    return student_out(s)


class SlotChangeIn(In):
    time_slot_id: int
    reason: OptText = None


@router.post("/students/{code}/change-time-slot")
def change_time_slot(code: str, body: SlotChangeIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.edit"))):
    s = get_student(db, code, lock=True)
    if body.time_slot_id == s.time_slot_id:
        raise bad("SAME_TIME_SLOT", "The student is already in this time slot.", "time_slot_id")
    slot = valid_slot(db, body.time_slot_id, s.course_id)  # same course only; a course transfer is a separate decision
    old = s.time_slot
    db.add(StudentTimeSlotHistory(student_id=s.id, old_time_slot_id=old.id, new_time_slot_id=slot.id, changed_by=user.id, reason=body.reason))
    s.time_slot_id = slot.id
    audit(db, user.id, "STUDENT_TIME_SLOT_CHANGED", "Student", s.student_code, f"{s.full_name} moved from {old.name} to {slot.name}",
          {"time_slot": old.name}, {"time_slot": slot.name}, body.reason)
    db.flush()
    warn = capacity_warning(db, slot)
    db.commit()
    db.refresh(s)
    return student_out(s) | {"capacity_warning": warn}


@router.get("/students/{code}/time-slot-history")
def time_slot_history(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    s = get_student(db, code, archived_ok=True)
    rows = db.scalars(select(StudentTimeSlotHistory).where(StudentTimeSlotHistory.student_id == s.id).order_by(StudentTimeSlotHistory.changed_at.desc())).all()
    slots = {t.id: t.name for t in db.scalars(select(TimeSlot).where(TimeSlot.id.in_({r.old_time_slot_id for r in rows} | {r.new_time_slot_id for r in rows})))}
    names = user_names(db, [r.changed_by for r in rows])
    return [{"at": r.changed_at, "from": slots.get(r.old_time_slot_id), "to": slots.get(r.new_time_slot_id), "by": user_ref(names, r.changed_by),
             "reason": r.reason} for r in rows]


@router.get("/students/{code}/aadhaar")
def reveal_aadhaar(code: str, db: Session = Depends(get_db), user: CurrentUser = Depends(require_admin)):
    s = get_student(db, code, archived_ok=True)
    if not s.aadhaar_ciphertext:
        raise not_found("aadhaar")
    value = aadhaar_decrypt(s.aadhaar_ciphertext)
    audit(db, user.id, "AADHAAR_REVEALED", "Student", s.student_code, f"Aadhaar revealed for {s.full_name}")
    db.commit()
    return {"aadhaar": " ".join(value[i:i + 4] for i in range(0, 12, 4))}
