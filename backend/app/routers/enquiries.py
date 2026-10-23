"""Admission desk: enquiries, follow-ups and conversion to a student."""
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..common import (
    In, Mobile, OptAadhaar, OptEmail, OptStr, OptText, Paging, Str, aadhaar_columns, aadhaar_decrypt, aadhaar_mask, apply_changes, audit,
    bounds, like, next_code, paginate, paging, today, user_names, user_ref,
)
from ..db import get_db
from ..errors import conflict, not_found
from ..models import Course, CourseSubtype, Enquiry, EnquiryActivity, Student, User
from ..security import CurrentUser, require, require_admin
from .students import AdmissionIn, admit, check_course_choice

router = APIRouter(prefix="/enquiries", tags=["enquiries"])
STATUSES = ("New", "Pending", "Follow-Up", "Converted")


class EnquiryIn(In):
    student_name: Str(160)
    mobile: Mobile
    guardian_name: OptStr(160) = None
    email: OptEmail = None
    address: OptText = None
    reference: OptText = None
    aadhaar: OptAadhaar = None
    course_id: int | None = None
    course_subtype_id: int | None = None


class EnquiryPatch(In):
    student_name: Str(160) | None = None
    mobile: Mobile | None = None
    guardian_name: OptStr(160) = None
    email: OptEmail = None
    address: OptText = None
    reference: OptText = None
    aadhaar: OptAadhaar = None
    course_id: int | None = None
    course_subtype_id: int | None = None


def _get(db: Session, code: str, lock: bool = False) -> Enquiry:
    stmt = select(Enquiry).where(Enquiry.enquiry_code == code)
    e = db.scalars(stmt.with_for_update() if lock else stmt).first()
    if e is None:
        raise not_found("enquiry")
    return e


def enquiry_out(db: Session, e: Enquiry, names: dict | None = None) -> dict:
    names = names if names is not None else user_names(db, [e.handling_staff_id, e.created_by])
    c = db.get(Course, e.course_id) if e.course_id else None
    st = db.get(CourseSubtype, e.course_subtype_id) if e.course_subtype_id else None
    return {"code": e.enquiry_code, "student_name": e.student_name, "guardian_name": e.guardian_name, "mobile": e.mobile, "email": e.email,
            "address": e.address, "reference": e.reference, "aadhaar_masked": aadhaar_mask(e.aadhaar_last4),
            "course": {"id": c.id, "code": c.code, "name": c.name} if c else None, "course_subtype": {"id": st.id, "name": st.name} if st else None,
            "status": e.status, "handling_staff": user_ref(names, e.handling_staff_id), "created_by": user_ref(names, e.created_by),
            "student_code": db.scalar(select(Student.student_code).where(Student.enquiry_id == e.id)),
            "created_at": e.created_at, "updated_at": e.updated_at}


@router.get("")
def list_enquiries(q: str | None = None, status: Literal["New", "Pending", "Follow-Up", "Converted"] | None = None,
                   created_from: date | None = None, created_to: date | None = None, staff_id: int | None = None,
                   p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    stmt = select(Enquiry).order_by(Enquiry.created_at.desc(), Enquiry.id.desc())
    if q:
        stmt = stmt.where(or_(Enquiry.enquiry_code.ilike(like(q)), Enquiry.student_name.ilike(like(q)), Enquiry.mobile.like(like(q.replace(" ", "")))))
    if status:
        stmt = stmt.where(Enquiry.status == status)
    if created_from or created_to:
        start, end = bounds(created_from or date(2000, 1, 1), created_to or today())
        stmt = stmt.where(Enquiry.created_at >= start, Enquiry.created_at < end)
    if staff_id:
        stmt = stmt.where(Enquiry.handling_staff_id == staff_id)
    names = dict(db.execute(select(User.id, User.full_name)).all())
    return paginate(db, stmt, p, lambda e: enquiry_out(db, e, names))


@router.get("/summary")
def enquiry_summary(db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    by_status = {s: 0 for s in STATUSES} | dict(db.execute(select(Enquiry.status, func.count()).group_by(Enquiry.status)).all())
    staff = db.execute(select(User.id, User.full_name, func.count(Enquiry.id)).join(Enquiry, Enquiry.handling_staff_id == User.id)
                       .group_by(User.id, User.full_name).order_by(User.full_name)).all()
    return {"total": sum(by_status.values()), "by_status": by_status,
            "confirmed_admissions": db.scalar(select(func.count()).select_from(Student)),
            "by_staff": [{"staff_id": i, "name": n, "count": c} for i, n, c in staff]}


@router.post("", status_code=201)
def create_enquiry(body: EnquiryIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.create"))):
    check_course_choice(db, body.course_id, body.course_subtype_id)
    data = body.model_dump(exclude={"aadhaar"})
    e = Enquiry(enquiry_code=next_code(db, "ENQUIRY"), status="New", handling_staff_id=user.id, created_by=user.id,
                **data, **aadhaar_columns(body.aadhaar))
    db.add(e)
    db.flush()
    db.add(EnquiryActivity(enquiry_id=e.id, actor_id=user.id, old_status=None, new_status="New", note=None))
    audit(db, user.id, "ENQUIRY_CREATED", "Enquiry", e.enquiry_code, f"Enquiry created for {e.student_name}")
    db.commit()
    return enquiry_out(db, e)


@router.get("/{code}")
def get_enquiry(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    return enquiry_out(db, _get(db, code))


@router.patch("/{code}")
def update_enquiry(code: str, body: EnquiryPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.create"))):
    e = _get(db, code, lock=True)
    if e.status == "Converted":
        raise conflict("ENQUIRY_CONVERTED", "Converted enquiries cannot be changed.")
    data = body.model_dump(exclude_unset=True)
    subtype_id = data.get("course_subtype_id", None if "course_id" in data else e.course_subtype_id)  # new course clears the sub-type
    if "course_id" in data:
        data["course_subtype_id"] = subtype_id
    check_course_choice(db, data.get("course_id", e.course_id), subtype_id)
    aadhaar_changed = "aadhaar" in data
    if aadhaar_changed:
        data.update(aadhaar_columns(data.pop("aadhaar")))
    before, after = apply_changes(e, data)
    for k in ("aadhaar_ciphertext", "aadhaar_lookup_hash", "aadhaar_last4"):
        before.pop(k, None), after.pop(k, None)
    if aadhaar_changed:
        before["aadhaar"], after["aadhaar"] = "(hidden)", "changed"
    if after:
        audit(db, user.id, "ENQUIRY_UPDATED", "Enquiry", e.enquiry_code, f"Enquiry {e.enquiry_code} updated", before, after)
    db.commit()
    return enquiry_out(db, e)


@router.get("/{code}/activities")
def activities(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("students.view"))):
    e = _get(db, code)
    rows = db.scalars(select(EnquiryActivity).where(EnquiryActivity.enquiry_id == e.id).order_by(EnquiryActivity.created_at.desc(), EnquiryActivity.id.desc())).all()
    names = user_names(db, [a.actor_id for a in rows])

    def action(a):
        return "Enquiry created" if a.old_status is None else "Admission confirmed" if a.new_status == "Converted" else "Status updated"
    return [{"at": a.created_at, "by": user_ref(names, a.actor_id), "action": action(a), "old_status": a.old_status,
             "status": a.new_status, "note": a.note} for a in rows]


class FollowUpIn(In):
    status: Literal["New", "Pending", "Follow-Up"]
    note: OptText = None


@router.post("/{code}/followups", status_code=201)
def follow_up(code: str, body: FollowUpIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.create"))):
    e = _get(db, code, lock=True)
    if e.status == "Converted":
        raise conflict("ENQUIRY_CONVERTED", "Converted enquiries cannot be changed.")
    old = e.status
    e.status, e.handling_staff_id = body.status, user.id
    db.add(EnquiryActivity(enquiry_id=e.id, actor_id=user.id, old_status=old, new_status=body.status, note=body.note))
    audit(db, user.id, "ENQUIRY_FOLLOWUP", "Enquiry", e.enquiry_code, f"{old} -> {body.status}", {"status": old}, {"status": body.status})
    db.commit()
    return enquiry_out(db, e)


@router.post("/{code}/convert", status_code=201)
def convert(code: str, body: AdmissionIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=120),
            db: Session = Depends(get_db), user: CurrentUser = Depends(require("students.create"))):
    return admit(db, code, body, user, idempotency_key)


@router.get("/{code}/aadhaar")
def reveal_enquiry_aadhaar(code: str, db: Session = Depends(get_db), user: CurrentUser = Depends(require_admin)):
    e = _get(db, code)
    if not e.aadhaar_ciphertext:
        raise not_found("aadhaar")
    value = aadhaar_decrypt(e.aadhaar_ciphertext)
    audit(db, user.id, "AADHAAR_REVEALED", "Enquiry", e.enquiry_code, f"Aadhaar revealed for enquiry {e.enquiry_code}")
    db.commit()
    return {"aadhaar": " ".join(value[i:i + 4] for i in range(0, 12, 4))}
