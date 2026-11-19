"""Courses, course sub-types and time slots (batches)."""
from datetime import date, time

from fastapi import APIRouter, Depends
from pydantic import Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..common import In, Money, OptText, Str, apply_changes, audit, like, money, now, today
from ..db import get_db
from ..errors import AppError, conflict, not_found
from ..models import Course, CourseSubtype, Student, TimeSlot
from ..security import CurrentUser, get_current_user, require, require_any

router = APIRouter(tags=["academics"])
manage = require("courses.manage")
manage_slots = require_any("batches.manage", "courses.manage")


# ----------------------------------------------------------------- helpers shared with admissions


def get_course(db: Session, course_id: int) -> Course:
    c = db.get(Course, course_id)
    if c is None or c.deleted_at is not None:
        raise not_found("course")
    return c


def slot_status(s: TimeSlot, t: date) -> str:
    if s.end_date and s.end_date < t:
        return "Completed"
    if s.start_date and s.start_date > t:
        return "Upcoming"
    return "Running"


def fmt_time(v: time) -> str:
    return f"{v.hour % 12 or 12}:{v.minute:02d} {'AM' if v.hour < 12 else 'PM'}"


def active_count(db: Session, col, value) -> int:
    return db.scalar(select(func.count()).where(col == value, Student.status == "Active", Student.deleted_at.is_(None))) or 0


def course_out(c: Course) -> dict:
    return {"id": c.id, "code": c.code, "name": c.name, "duration_months": int(c.duration) if (c.duration or "").isdigit() else None,
            "fee": money(c.fee), "description": c.description, "is_active": c.is_active, "created_at": c.created_at, "updated_at": c.updated_at}


def slot_out(s: TimeSlot, assigned: int | None = None) -> dict:
    out = {"id": s.id, "course_id": s.course_id, "course_subtype": {"id": s.subtype.id, "name": s.subtype.name} if s.subtype else None, "name": s.name, "start_time": s.start_time.strftime("%H:%M"),
           "end_time": s.end_time.strftime("%H:%M"), "timing": f"{fmt_time(s.start_time)} – {fmt_time(s.end_time)}",
           "days": s.days_of_week, "faculty": s.faculty_name, "capacity": s.capacity, "start_date": s.start_date,
           "end_date": s.end_date, "is_active": s.is_active, "status": slot_status(s, today())}
    if assigned is not None:
        out["assigned_students"] = assigned
        out["seats_left"] = s.capacity - assigned
    return out


# ----------------------------------------------------------------- courses


class CourseIn(In):
    code: Str(32)
    name: Str(160)
    duration_months: int = Field(ge=1, le=60)
    fee: Money
    description: OptText = None


class CoursePatch(In):
    code: Str(32) | None = None
    name: Str(160) | None = None
    duration_months: int | None = Field(None, ge=1, le=60)
    fee: Money | None = None
    description: OptText = None


def _course_columns(data: dict) -> dict:
    if "code" in data:
        data["code"] = data["code"].upper()
    if "duration_months" in data:
        data["duration"] = str(data.pop("duration_months"))
    return data


@router.get("/courses")
def list_courses(active: bool | None = None, q: str | None = None, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    stmt = select(Course).where(Course.deleted_at.is_(None)).order_by(Course.name)
    if active is not None:
        stmt = stmt.where(Course.is_active.is_(active))
    if q:
        stmt = stmt.where(Course.name.ilike(like(q)) | Course.code.ilike(like(q)))
    courses = db.scalars(stmt).all()
    students = dict(db.execute(select(Student.course_id, func.count()).where(Student.status == "Active", Student.deleted_at.is_(None)).group_by(Student.course_id)).all())
    t = today()
    slots, subtypes = {}, {}
    for s in db.scalars(select(TimeSlot).where(TimeSlot.is_active.is_(True))):
        slots[s.course_id] = slots.get(s.course_id, 0) + (slot_status(s, t) != "Completed")
    for st in db.scalars(select(CourseSubtype).where(CourseSubtype.is_active.is_(True)).order_by(CourseSubtype.name)):
        subtypes.setdefault(st.course_id, []).append({"id": st.id, "name": st.name, "fee": money(st.fee) if st.fee is not None else None})
    return [course_out(c) | {"active_students": students.get(c.id, 0), "time_slots": slots.get(c.id, 0), "subtypes": subtypes.get(c.id, [])} for c in courses]


@router.post("/courses", status_code=201)
def create_course(body: CourseIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = Course(**_course_columns(body.model_dump()), is_active=True)
    db.add(c)
    db.flush()
    audit(db, user.id, "COURSE_CREATED", "Course", c.code, f"Course {c.code} created", after=course_out(c) | {"created_at": None, "updated_at": None})
    db.commit()
    return course_out(c)


@router.get("/courses/{course_id}")
def get_course_api(course_id: int, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    return course_out(get_course(db, course_id))


@router.patch("/courses/{course_id}")
def update_course(course_id: int, body: CoursePatch, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = get_course(db, course_id)
    before, after = apply_changes(c, _course_columns(body.model_dump(exclude_unset=True)))
    if after:
        # Fee changes never rewrite existing students: agreed_fee is copied at admission.
        audit(db, user.id, "COURSE_UPDATED", "Course", c.code, f"{c.name} updated", before, after)
    db.commit()
    return course_out(c)


def _set_active(db: Session, obj, active: bool, user: CurrentUser, action: str, entity: str, ref: str):
    if obj.is_active != active:
        obj.is_active = active
        audit(db, user.id, f"{action}_{'ACTIVATED' if active else 'DEACTIVATED'}", entity, ref, f"{entity} {ref} {'activated' if active else 'deactivated'}")
    db.commit()


@router.post("/courses/{course_id}/activate")
def activate_course(course_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = get_course(db, course_id)
    _set_active(db, c, True, user, "COURSE", "Course", c.code)
    return course_out(c)


@router.post("/courses/{course_id}/deactivate")
def deactivate_course(course_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = get_course(db, course_id)
    _set_active(db, c, False, user, "COURSE", "Course", c.code)
    return course_out(c)


@router.delete("/courses/{course_id}", status_code=204)
def delete_course(course_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = get_course(db, course_id)
    if db.scalar(select(func.count()).where(Student.course_id == c.id)):
        raise conflict("COURSE_IN_USE", "This course has enrolled students, so it can only be deactivated.")
    c.deleted_at, c.is_active = now(), False
    audit(db, user.id, "COURSE_DELETED", "Course", c.code, f"Course {c.code} deleted")
    db.commit()


# ----------------------------------------------------------------- sub-types


class SubtypeIn(In):
    name: Str(150)
    fee: Money | None = None  # 19 Nov: optional own fee (empty = no fee of its own; the course fee applies)


class SubtypePatch(In):
    name: Str(150) | None = None
    fee: Money | None = None  # send null to clear


def _subtype(db: Session, subtype_id: int) -> CourseSubtype:
    s = db.get(CourseSubtype, subtype_id)
    if s is None:
        raise not_found("course subtype")
    return s


def _check_subtype_name(db: Session, course_id: int, name: str, exclude_id: int | None = None):
    # ponytail: case-insensitive uniqueness checked here; the DB unique is case-sensitive (index on lower(name) requested).
    dup = select(CourseSubtype.id).where(CourseSubtype.course_id == course_id, func.lower(CourseSubtype.name) == name.lower())
    if exclude_id:
        dup = dup.where(CourseSubtype.id != exclude_id)
    if db.scalar(dup):
        raise conflict("SUBTYPE_EXISTS", "This sub-type already exists for the course.")


def subtype_out(s: CourseSubtype) -> dict:
    return {"id": s.id, "course_id": s.course_id, "name": s.name, "fee": money(s.fee) if s.fee is not None else None, "is_active": s.is_active}


@router.get("/courses/{course_id}/subtypes")
def list_subtypes(course_id: int, active: bool | None = None, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    stmt = select(CourseSubtype).where(CourseSubtype.course_id == get_course(db, course_id).id).order_by(CourseSubtype.name)
    if active is not None:
        stmt = stmt.where(CourseSubtype.is_active.is_(active))
    return [subtype_out(s) for s in db.scalars(stmt)]


@router.post("/courses/{course_id}/subtypes", status_code=201)
def create_subtype(course_id: int, body: SubtypeIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = get_course(db, course_id)
    _check_subtype_name(db, c.id, body.name)
    s = CourseSubtype(course_id=c.id, name=body.name, fee=body.fee, is_active=True)
    db.add(s)
    audit(db, user.id, "COURSE_SUBTYPE_CREATED", "Course", c.code, f"Sub-type {body.name} added to {c.code}" + (f" (fee {money(body.fee)})" if body.fee is not None else ""))
    db.commit()
    return subtype_out(s)


@router.patch("/course-subtypes/{subtype_id}")
def rename_subtype(subtype_id: int, body: SubtypePatch, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    """Rename and/or set the fee. A new fee applies to future admissions only: enrolled students keep the fee they agreed."""
    s = _subtype(db, subtype_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name") is None:
        data.pop("name", None)
    else:
        _check_subtype_name(db, s.course_id, data["name"], s.id)
    before, after = apply_changes(s, data)
    if after:
        audit(db, user.id, "COURSE_SUBTYPE_UPDATED", "Course Subtype", str(s.id), f"Sub-type {s.name} updated", before, after)
    db.commit()
    return subtype_out(s)


@router.post("/course-subtypes/{subtype_id}/activate")
def activate_subtype(subtype_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    s = _subtype(db, subtype_id)
    _set_active(db, s, True, user, "COURSE_SUBTYPE", "Course Subtype", str(s.id))
    return subtype_out(s)


@router.post("/course-subtypes/{subtype_id}/deactivate")
def deactivate_subtype(subtype_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    s = _subtype(db, subtype_id)
    _set_active(db, s, False, user, "COURSE_SUBTYPE", "Course Subtype", str(s.id))
    return subtype_out(s)


# ----------------------------------------------------------------- time slots


class SlotIn(In):
    course_id: int
    course_subtype_id: int | None = None  # 19 Nov: a slot can be for one sub-type of the course; empty = the whole course
    name: Str(120)
    start_time: time
    end_time: time
    days: Str(100) = "Mon – Sat"
    faculty: OptText = None
    capacity: int = Field(ge=1, le=1000)
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def _rules(self):
        if not (time(8) <= self.start_time and self.end_time <= time(21) and self.end_time > self.start_time):
            raise ValueError("Time slot must be between 8:00 AM and 9:00 PM and end after it starts")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("End date can't be before start date")
        return self


class SlotPatch(In):
    course_subtype_id: int | None = None  # send null to make it a whole-course slot again
    name: Str(120) | None = None
    start_time: time | None = None
    end_time: time | None = None
    days: Str(100) | None = None
    faculty: OptText = None
    capacity: int | None = Field(None, ge=1, le=1000)
    start_date: date | None = None
    end_date: date | None = None


def _slot(db: Session, slot_id: int) -> TimeSlot:
    s = db.get(TimeSlot, slot_id)
    if s is None:
        raise not_found("time slot")
    return s


def _check_slot_subtype(db: Session, course_id: int, subtype_id: int | None, current: int | None = None) -> None:
    """The sub-type must belong to the slot's course (and be active, unless the slot already had it)."""
    if subtype_id is None:
        return
    st = db.get(CourseSubtype, subtype_id)
    if st is None or st.course_id != course_id or (not st.is_active and st.id != current):
        raise AppError(400, "SUBTYPE_MISMATCH", "Choose a sub-type of this course.", {"course_subtype_id": "Choose a sub-type of this course."})


def _slot_columns(data: dict) -> dict:
    if "days" in data:
        data["days_of_week"] = data.pop("days")
    if "faculty" in data:
        data["faculty_name"] = data.pop("faculty")
    return data


@router.get("/time-slots")
def list_slots(course_id: int | None = None, active: bool | None = None, include_completed: bool = True,
               db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    stmt = select(TimeSlot).options(selectinload(TimeSlot.course), selectinload(TimeSlot.subtype)).order_by(TimeSlot.start_time, TimeSlot.name)
    if course_id:
        stmt = stmt.where(TimeSlot.course_id == course_id)
    if active is not None:
        stmt = stmt.where(TimeSlot.is_active.is_(active))
    counts = dict(db.execute(select(Student.time_slot_id, func.count()).where(Student.status == "Active", Student.deleted_at.is_(None)).group_by(Student.time_slot_id)).all())
    t = today()
    return [slot_out(s, counts.get(s.id, 0)) | {"course": {"id": s.course.id, "code": s.course.code, "name": s.course.name}}
            for s in db.scalars(stmt) if include_completed or slot_status(s, t) != "Completed"]


@router.post("/time-slots", status_code=201)
def create_slot(body: SlotIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_slots)):
    c = get_course(db, body.course_id)
    if not c.is_active:
        raise AppError(400, "COURSE_INACTIVE", "Choose an active course.", {"course_id": "Choose an active course."})
    _check_slot_subtype(db, c.id, body.course_subtype_id)
    s = TimeSlot(**_slot_columns(body.model_dump()), is_active=True)
    db.add(s)
    db.flush()
    audit(db, user.id, "TIME_SLOT_CREATED", "Time Slot", str(s.id), f"Time slot {s.name} added to {c.code}")
    db.commit()
    return slot_out(s, 0)


@router.get("/time-slots/{slot_id}")
def get_slot(slot_id: int, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    s = _slot(db, slot_id)
    return slot_out(s, active_count(db, Student.time_slot_id, s.id))


@router.patch("/time-slots/{slot_id}")
def update_slot(slot_id: int, body: SlotPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_slots)):
    s = _slot(db, slot_id)
    data = _slot_columns(body.model_dump(exclude_unset=True))
    SlotIn(course_id=s.course_id, name=data.get("name", s.name), start_time=data.get("start_time", s.start_time),  # validate merged values
           end_time=data.get("end_time", s.end_time), days=data.get("days_of_week", s.days_of_week),
           faculty=data.get("faculty_name", s.faculty_name), capacity=data.get("capacity", s.capacity),
           start_date=data.get("start_date", s.start_date), end_date=data.get("end_date", s.end_date))
    if "course_subtype_id" in data:
        _check_slot_subtype(db, s.course_id, data["course_subtype_id"], s.course_subtype_id)
    before, after = apply_changes(s, data)
    if after:
        audit(db, user.id, "TIME_SLOT_UPDATED", "Time Slot", str(s.id), f"Time slot {s.name} updated", before, after)
    db.commit()
    return slot_out(s, active_count(db, Student.time_slot_id, s.id))


@router.post("/time-slots/{slot_id}/activate")
def activate_slot(slot_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_slots)):
    s = _slot(db, slot_id)
    _set_active(db, s, True, user, "TIME_SLOT", "Time Slot", str(s.id))
    return slot_out(s)


@router.post("/time-slots/{slot_id}/deactivate")
def deactivate_slot(slot_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_slots)):
    s = _slot(db, slot_id)
    _set_active(db, s, False, user, "TIME_SLOT", "Time Slot", str(s.id))
    return slot_out(s)
