"""Admission (enquiry -> student), student list/profile, edit, status, archive, change time slot.
25 Nov 2026: Aadhaar removed (no longer collected, shown, searched or revealed)."""
import re
from datetime import date
from decimal import ROUND_FLOOR, Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import Field, model_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..common import (
    ZERO, In, Mobile, Money, OptEmail, OptMobile, OptStr, OptText, Paging, PayMode, Reason, Str,
    add_months_clamped, apply_changes, audit, like, money, next_code, now, paginate,
    paging, today, user_names, user_ref,
)
from ..db import get_db
from ..errors import bad, conflict, not_found
from ..ledger import INSTALLMENT_NO_OFFSET, fee_cols, fee_summary, pct, reallocate, summarize_installments
from ..models import (
    Course, CourseSubtype, Enquiry, EnquiryActivity, FeeReceipt, FeeReminderEvent, AuditLog, Student, StudentInstallment, StudentPayment,
    StudentPaymentAllocation,
    StudentTimeSlotHistory, TimeSlot,
)
from ..security import CurrentUser, require
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


class InstallmentIn(In):
    due_date: date
    amount: Money


def check_plan(rows: list[InstallmentIn], total: Decimal, earliest: date, field: str = "installments") -> None:
    """16 Nov (client): installment dates and amounts are set by hand. Rules: 1-8 rows, each amount above zero,
    dates in order and not before the admission date, and together exactly the amount still to be paid."""
    if not 1 <= len(rows) <= 8:
        raise bad("INSTALLMENTS_REQUIRED", "Choose 1 to 8 installments for the outstanding balance.", field)
    if any(r.amount <= 0 for r in rows):
        raise bad("INSTALLMENT_AMOUNT_INVALID", "Every installment needs an amount above zero.", field)
    if any(r.due_date < earliest for r in rows):
        raise bad("INSTALLMENT_DATE_INVALID", f"Installment dates can't be before {earliest.strftime('%d %b %Y')}.", field)
    if any(b.due_date < a.due_date for a, b in zip(rows, rows[1:])):
        raise bad("INSTALLMENT_DATES_ORDER", "Put the installments in date order.", field)
    got = sum((r.amount for r in rows), ZERO)
    if got != total:
        raise bad("INSTALLMENTS_TOTAL_MISMATCH", f"Installments add up to {money(got)} but {money(total)} is still to be paid.", field)


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
    education_qualification: OptStr(200) = None
    remark: OptText = None
    course_id: int
    course_subtype_id: int | None = None  # older clients: one sub-type
    course_subtype_ids: list[int] | None = Field(None, max_length=20)  # 16 Nov: any number of sub-types (checkboxes)
    time_slot_id: int
    discount: Money = ZERO
    paid_now: Money = ZERO
    payment_mode: PayMode | None = None
    payment_reference: OptStr(150) = None
    installment_count: int = Field(0, ge=0, le=8)
    first_due_date: date | None = None
    installments: list[InstallmentIn] | None = Field(None, max_length=8)  # hand-set plan; replaces count + first date

    @model_validator(mode="after")
    def _rules(self):
        if self.dob >= today():
            raise ValueError("Date of birth must be in the past")
        if self.paid_now > 0 and not self.payment_mode:
            raise ValueError("Payment mode is required when an amount is paid now")
        return self


def wanted_subtypes(ids: list[int] | None, single: int | None) -> list[int]:
    """The list wins; otherwise the single sub-type older screens send. Duplicates dropped, order kept."""
    return list(dict.fromkeys(ids if ids is not None else ([single] if single else [])))


def check_subtypes(db: Session, course_id: int | None, ids: list[int], *, existing_ids: frozenset[int] = frozenset()) -> list[CourseSubtype]:
    if not ids:
        return []
    if not course_id:
        raise bad("SUBTYPE_WITHOUT_COURSE", "Choose a course before a sub-type.", "course_subtype_id")
    if not get_course(db, course_id).is_active:
        raise bad("COURSE_INACTIVE", "Choose an active course.", "course_id")
    offered = {s.id: s for s in db.scalars(
        select(CourseSubtype).where(CourseSubtype.course_id == course_id, CourseSubtype.id.in_(ids)).with_for_update(read=True)
    )}
    if any(i not in offered or (not offered[i].is_active and i not in existing_ids) for i in ids):
        raise bad("SUBTYPE_MISMATCH", "Choose an active sub-type of the selected course.", "course_subtype_id")
    return [offered[i] for i in ids]


def subtypes_out(items: list[CourseSubtype]) -> list[dict]:
    return [{"id": st.id, "name": st.name} for st in items]


def _check_slot_subtype(slot: TimeSlot, subtype_ids: list[int], field: str) -> None:
    if slot.course_subtype_id is not None and slot.course_subtype_id not in subtype_ids:
        raise bad("TIME_SLOT_SUBTYPE_MISMATCH", "Choose a batch and sub-types that match each other.", field)


def valid_slot(db: Session, slot_id: int, course_id: int, subtype_ids: list[int]) -> TimeSlot:
    # Shared locks allow concurrent enrolments and serialize assignment changes to the slot.
    slot = db.get(TimeSlot, slot_id, with_for_update={"read": True}, populate_existing=True)
    if slot is None or slot.course_id != course_id or not slot.is_active or slot_status(slot, today()) == "Completed":
        raise bad("INVALID_TIME_SLOT", "Choose a valid time slot for the course.", "time_slot_id")
    _check_slot_subtype(slot, subtype_ids, "time_slot_id")
    return slot


def admission_fee(course: Course, chosen: list[CourseSubtype]) -> Decimal:
    priced = {st.id: st.fee for st in chosen if st.fee is not None}
    return sum(priced.values(), ZERO) if priced else course.fee


def capacity_warning(db: Session, slot: TimeSlot) -> bool:
    # Capacity is advisory (UI allows over-capacity admission); never a hard block.
    n = db.scalar(select(func.count()).where(Student.time_slot_id == slot.id, Student.status == "Active", Student.deleted_at.is_(None)))
    return n > slot.capacity


def admit(db: Session, enquiry_code: str, body: AdmissionIn, user: CurrentUser, idempotency_key: str | None = None) -> dict:
    e = db.scalars(select(Enquiry).where(Enquiry.enquiry_code == enquiry_code).with_for_update()).first()
    if e is None:
        raise not_found("enquiry")
    if idempotency_key:  # QA-07: a retried admission (same key) returns the original instead of "already converted"
        prior = db.scalars(select(StudentPayment).where(StudentPayment.idempotency_key == idempotency_key)).first()
        if prior is not None:
            s = db.get(Student, prior.student_id)
            if s is None or s.enquiry_id != e.id:
                raise conflict("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for another request.")
            receipt = db.scalars(select(FeeReceipt).where(FeeReceipt.payment_id == prior.id)).first()
            return {"student": student_out(s), "fees": fee_summary(db, s, today()), "capacity_warning": False,
                    "payment": payment_out(prior, receipt.receipt_code if receipt else None, s, user_names(db, [prior.collected_by])),
                    "receipt": receipt_out(receipt, prior, s) if receipt else None, "replayed": True}
    if e.status == "Converted" or db.scalar(select(Student.id).where(Student.enquiry_id == e.id)):
        raise conflict("ENQUIRY_ALREADY_CONVERTED", "This enquiry is already converted to a student.")
    if e.course_id and e.course_id != body.course_id:
        raise bad("COURSE_MISMATCH", "The admission course must match the enquiry course.", "course_id")
    chosen = check_subtypes(db, body.course_id, wanted_subtypes(body.course_subtype_ids, body.course_subtype_id))
    course = get_course(db, body.course_id)
    slot = valid_slot(db, body.time_slot_id, course.id, [st.id for st in chosen])
    fee = admission_fee(course, chosen)
    if fee > Decimal("9999999999.99"):
        raise bad("ADMISSION_FEE_TOO_HIGH", "The combined subtype fees exceed the maximum admission fee.", "course_subtype_ids")
    if body.discount > fee:
        raise bad("DISCOUNT_EXCEEDS_FEE", "Discount can't exceed the admission fee.", "discount")
    net = fee - body.discount
    if body.paid_now > net:
        raise bad("PAID_EXCEEDS_NET_FEE", f"Can't exceed net fee of {money(net)}.", "paid_now")
    rest = net - body.paid_now
    if body.installments is not None:  # hand-set dates and amounts
        if rest == 0 and body.installments:
            raise bad("INSTALLMENTS_NOT_NEEDED", "No installments are needed when the full fee is paid now.", "installments")
        if rest > 0:
            check_plan(body.installments, rest, today())
    elif rest > 0 and not 1 <= body.installment_count <= 8:
        raise bad("INSTALLMENTS_REQUIRED", "Choose 1 to 8 installments for the outstanding balance.", "installment_count")
    if rest == 0 and body.installment_count:
        raise bad("INSTALLMENTS_NOT_NEEDED", "No installments are needed when the full fee is paid now.", "installment_count")
    if rest > 0 and body.installments is None and body.first_due_date is None:
        raise bad("FIRST_DUE_DATE_REQUIRED", "Choose a valid first due date.", "first_due_date")
    if body.paid_now > 0 and body.payment_mode == "Bank" and not body.payment_reference:
        raise bad("REFERENCE_REQUIRED", "Transaction / UTR reference is required for bank transfers.", "payment_reference")

    t = today()
    s = Student(
        student_code=next_code(db, "STUDENT"), enquiry_id=e.id, full_name=body.full_name, guardian_name=body.guardian_name, dob=body.dob,
        gender=body.gender, mobile=body.mobile, whatsapp_number=body.whatsapp_number or body.mobile, email=body.email, address=body.address,
        education_qualification=body.education_qualification, remark=body.remark, reference=e.reference, course=course,
        course_subtype_id=chosen[0].id if chosen else None, time_slot=slot, admission_date=t, status="Active", agreed_fee=fee,
        discount=body.discount, net_fee=net, created_by=user.id)  # an enquiry's old Aadhaar is never copied (25 Nov)
    s.subtypes = chosen
    db.add(s)
    db.flush()
    if body.installments is not None:
        plan = [(0, t, body.paid_now)] + [(k, r.due_date, r.amount) for k, r in enumerate(body.installments if rest > 0 else [], 1)]
    else:
        plan = build_schedule(net, body.paid_now, body.installment_count if rest > 0 else 0, body.first_due_date, t)
    installments = [StudentInstallment(student_id=s.id, installment_no=no + INSTALLMENT_NO_OFFSET,
                                       due_date=due, amount=amount, paid_amount=ZERO) for no, due, amount in plan]
    db.add_all(installments)
    old = e.status
    e.status, e.handling_staff_id = "Converted", user.id
    db.add(EnquiryActivity(enquiry_id=e.id, actor_id=user.id, old_status=old, new_status="Converted", note=f"Student {s.student_code} created"))
    audit(db, user.id, "ENQUIRY_CONVERTED", "Enquiry", e.enquiry_code, f"{e.enquiry_code} converted to {s.student_code}")
    audit(db, user.id, "STUDENT_CREATED", "Student", s.student_code, f"Admission confirmed - {s.full_name} ({course.code})",
          after={"net_fee": money(net), "paid_now": money(body.paid_now), "installments": len(plan) - 1})
    warn = capacity_warning(db, slot)
    payment = receipt = None
    if body.paid_now > 0:
        payment, receipt, fees = record_payment(db, s, body.paid_now, body.payment_mode, body.payment_reference, "Admission payment", user,
                                                idempotency_key, new_installments=installments)
    else:
        fees = summarize_installments(s, t, installments)
    db.commit()
    return {"student": student_out(s), "fees": fees, "capacity_warning": warn,
            "payment": payment_out(payment, receipt.receipt_code, s, {user.id: user.full_name}) if payment else None,
            "receipt": receipt_out(receipt, payment, s) if receipt else None, "replayed": False}


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
        "education_qualification": s.education_qualification,
        "reference": s.reference, "remark": s.remark, "status": s.status, "admission_date": s.admission_date,
        "course": {"id": s.course.id, "code": s.course.code, "name": s.course.name,
                   "duration_months": int(s.course.duration) if (s.course.duration or "").isdigit() else None},
        "course_subtype": subtypes_out(s.subtypes[:1])[0] if s.subtypes else None,  # first one, for older screens
        "course_subtypes": subtypes_out(s.subtypes),
        "time_slot": {"id": slot.id, "name": slot.name, "timing": f"{fmt_time(slot.start_time)} – {fmt_time(slot.end_time)}",
                      "days": slot.days_of_week, "faculty": slot.faculty_name},
        "agreed_fee": money(s.agreed_fee), "discount": money(s.discount), "net_fee": money(s.net_fee),
        "archived": s.deleted_at is not None, "created_at": s.created_at, "updated_at": s.updated_at,
    }


def get_student(db: Session, code: str, lock: bool = False, archived_ok: bool = False, *, detail: bool = False) -> Student:
    stmt = select(Student).where(Student.student_code == code)
    if detail:
        stmt = stmt.options(joinedload(Student.course), joinedload(Student.time_slot), joinedload(Student.subtypes))
    s = db.scalars(stmt.with_for_update(of=Student) if lock else stmt).unique().first()
    if s is None or (s.deleted_at is not None and not archived_ok):
        raise not_found("student")
    return s


def search_filter(q: str):
    """Name, guardian, mobile, Student ID. (Aadhaar search removed 25 Nov 2026.)"""
    conds = [Student.full_name.ilike(like(q)), Student.guardian_name.ilike(like(q)), Student.student_code.ilike(like(q))]
    digits = re.sub(r"\D", "", q)
    if digits:
        conds.append(Student.mobile.like(like(digits)))
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
        joinedload(Student.course), joinedload(Student.time_slot))
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
    total, active = db.execute(select(func.count(), func.count().filter(Student.status == "Active"))
                               .where(Student.deleted_at.is_(None))).one()
    counts = {"total": total, "active": active}
    return paginate(db, stmt, p, lambda r: {
        "code": r[0].student_code, "full_name": r[0].full_name, "guardian_name": r[0].guardian_name, "mobile": r[0].mobile,
        "whatsapp_number": r[0].whatsapp_number or r[0].mobile,
        "course": {"id": r[0].course.id, "code": r[0].course.code, "name": r[0].course.name},
        "time_slot": {"id": r[0].time_slot.id, "name": r[0].time_slot.name}, "admission_date": r[0].admission_date, "status": r[0].status,
        "net_fee": money(r[0].net_fee), "paid": money(r[1]), "balance": money(r[2]), "paid_pct": pct(r[1], r[0].net_fee),
        "fee_state": r[5], "next_due": {"due_date": r[3], "amount": money(r[4])} if r[3] else None,
        "archived": r[0].deleted_at is not None}, scalars=False, counts=counts)


@router.get("/students/{code}")
def get_student_api(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    return student_out(get_student(db, code, archived_ok=True, detail=True))


@router.get("/students/{code}/profile")
def student_profile(code: str, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.view"))):
    s = get_student(db, code, archived_ok=True, detail=True)
    can_view_fees = user.can("fees.view")
    rows = db.execute(select(StudentPayment, FeeReceipt.receipt_code, FeeReceipt.issued_at).outerjoin(FeeReceipt, FeeReceipt.payment_id == StudentPayment.id)
                      .where(StudentPayment.student_id == s.id).order_by(StudentPayment.received_at.desc())).all() if can_view_fees else []
    reminders = db.scalars(select(FeeReminderEvent).where(FeeReminderEvent.student_id == s.id).order_by(FeeReminderEvent.opened_at.desc())).all()
    events = db.scalars(select(AuditLog).where(AuditLog.entity_type == "Student", AuditLog.entity_id == s.student_code)).all()
    names = user_names(db, [x.collected_by for x, _, _ in rows] + [x.reversed_by for x, _, _ in rows] + [r.opened_by for r in reminders] + [a.actor_id for a in events])
    payments = [payment_out(x, receipt, s, names) for x, receipt, _ in rows[:20]]
    activity = (
        [{"at": x.received_at, "type": "payment", "title": f"Fee received · {money(x.amount)} ({x.payment_mode})", "by": user_ref(names, x.collected_by),
          "ref": receipt} for x, receipt, _ in rows]
        + [{"at": x.reversed_at, "type": "reversal", "title": f"Payment reversed · {money(x.amount)}", "by": user_ref(names, x.reversed_by),
            "ref": receipt, "note": x.reversal_reason} for x, receipt, _ in rows if x.status == "Reversed"]
        + [{"at": e.opened_at, "type": "reminder", "title": "WhatsApp fee reminder opened", "by": user_ref(names, e.opened_by), "note": e.note} for e in reminders]
        + [{"at": a.created_at, "type": "change", "title": a.summary, "action": a.action, "by": user_ref(names, a.actor_id), "note": a.reason} for a in events]
    )
    activity.sort(key=lambda a: a["at"], reverse=True)
    fees = fee_summary(db, s, today()) if can_view_fees else None
    return {"student": student_out(s), "fees": fees, "payments": payments,
            "receipts": [{"receipt_no": receipt, "issued_at": issued, "amount": money(x.amount)}
                         for x, receipt, issued in rows if receipt and x.status == "Valid"],
            "last_reminded_at": reminders[0].opened_at if reminders else None, "activity": activity}


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
    course_subtype_id: int | None = None
    course_subtype_ids: list[int] | None = Field(None, max_length=20)
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
    subtype_change = None
    if "course_subtype_ids" in data or "course_subtype_id" in data:
        single = data.pop("course_subtype_id", None)
        ids = data.pop("course_subtype_ids", None)
        subtype_ids = wanted_subtypes(ids, single)
        subtype_change = check_subtypes(db, s.course_id, subtype_ids, existing_ids=frozenset(st.id for st in s.subtypes))
        slot = db.get(TimeSlot, s.time_slot_id, with_for_update={"read": True}, populate_existing=True)
        _check_slot_subtype(slot, subtype_ids, "course_subtype_ids")
    before, after = apply_changes(s, data)
    if subtype_change is not None and [x.id for x in subtype_change] != [x.id for x in s.subtypes]:
        before["sub_types"], after["sub_types"] = ", ".join(x.name for x in s.subtypes) or "-", ", ".join(x.name for x in subtype_change) or "-"
        s.subtypes, s.course_subtype_id = subtype_change, subtype_change[0].id if subtype_change else None
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
    subtype_ids = wanted_subtypes([st.id for st in s.subtypes] or None, s.course_subtype_id)
    slot = valid_slot(db, body.time_slot_id, s.course_id, subtype_ids)
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



# ----------------------------------------------------------------- change the installment plan later (16 Nov, client)


class PlanIn(In):
    installments: list[InstallmentIn] = Field(min_length=1, max_length=8)
    reason: OptText = None


@router.put("/students/{code}/installment-plan")
def change_installment_plan(code: str, body: PlanIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("fees.collect"))):
    """Re-plan what is still to be paid. Money already received never moves: a fully paid installment stays as it is,
    a part-paid one is closed at the amount received, and the new rows must add up to exactly the balance. The total
    fee doesn't change. Payments are then re-applied oldest first (reallocate), as after any payment."""
    s = get_student(db, code, lock=True)
    rows = db.scalars(select(StudentInstallment).where(StudentInstallment.student_id == s.id).order_by(StudentInstallment.installment_no)).all()
    before = [{"due_date": r.due_date.isoformat(), "amount": money(r.amount), "paid": money(r.paid_amount)} for r in rows]
    paid = sum((r.paid_amount for r in rows), ZERO)
    balance = s.net_fee - paid
    if balance <= 0:
        raise conflict("FEES_FULLY_PAID", "This student has paid the full fee; there is nothing left to schedule.")
    check_plan(body.installments, balance, s.admission_date)
    keep = [r for r in rows if r.installment_no == INSTALLMENT_NO_OFFSET or r.paid_amount > 0]
    drop = [r.id for r in rows if r not in keep]
    db.execute(delete(StudentPaymentAllocation).where(StudentPaymentAllocation.installment_id.in_([r.id for r in rows])))
    if drop:
        db.execute(delete(StudentInstallment).where(StudentInstallment.id.in_(drop)))
    for r in keep:  # a part-paid installment ends at what was received
        if r.installment_no != INSTALLMENT_NO_OFFSET and r.paid_amount < r.amount:
            r.amount = r.paid_amount
    db.flush()
    nxt = max(r.installment_no for r in keep) + 1
    for k, r in enumerate(body.installments):
        db.add(StudentInstallment(student_id=s.id, installment_no=nxt + k, due_date=r.due_date, amount=r.amount, paid_amount=ZERO))
    db.flush()
    reallocate(db, s.id)
    after = [{"due_date": r.due_date.isoformat(), "amount": money(r.amount)} for r in body.installments]
    audit(db, user.id, "FEE_PLAN_CHANGED", "Student", s.student_code, f"Installment plan changed for {s.full_name}" + (f": {body.reason}" if body.reason else ""),
          {"schedule": before}, {"remaining": after})
    db.commit()
    return fee_summary(db, s, today())
