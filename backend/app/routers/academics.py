"""Courses, course sub-types and time slots (batches)."""
from datetime import date, time

from fastapi import APIRouter, Depends
from pydantic import Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..common import In, Money, OptText, Str, apply_changes, audit, like, money, now, today
from ..db import get_db
from ..errors import AppError, bad, conflict, not_found
from ..models import Course, CourseSubtype, Student, StudentCourseSubtype, TimeSlot
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
    return db.scalar(active_count_stmt(col, value)) or 0


def active_count_stmt(col, value):
    return select(func.count()).where(col == value, Student.status == "Active", Student.deleted_at.is_(None))


def course_out(c: Course) -> dict:
    return {"id": c.id, "code": c.code, "name": c.name, "duration_months": int(c.duration) if (c.duration or "").isdigit() else None,
            "fee": money(c.fee), "description": c.description, "is_active": c.is_active, "created_at": c.created_at, "updated_at": c.updated_at}


def slot_out(s: TimeSlot, assigned: int | None = None) -> dict:
    subtype = s.course_subtype
    out = {"id": s.id, "course_id": s.course_id, "course_subtype_id": s.course_subtype_id,
           "course_subtype": {"id": subtype.id, "name": subtype.name} if subtype else None,
           "name": s.name, "start_time": s.start_time.strftime("%H:%M"),
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
    assigned = active_count_stmt(Student.course_id, Course.id).scalar_subquery()
    slots = select(func.count()).where(TimeSlot.course_id == Course.id, TimeSlot.is_active.is_(True),
                                       TimeSlot.end_date.is_(None) | (TimeSlot.end_date >= today())).scalar_subquery()
    stmt = select(Course, assigned, slots, CourseSubtype).outerjoin(
        CourseSubtype, (CourseSubtype.course_id == Course.id) & CourseSubtype.is_active.is_(True)
    ).where(Course.deleted_at.is_(None)).order_by(Course.name, Course.id, CourseSubtype.name)
    if active is not None:
        stmt = stmt.where(Course.is_active.is_(active))
    if q:
        stmt = stmt.where(Course.name.ilike(like(q)) | Course.code.ilike(like(q)))
    courses = {}
    for course, students, running_slots, subtype in db.execute(stmt):
        if course.id not in courses:
            courses[course.id] = course_out(course) | {"active_students": students, "time_slots": running_slots, "subtypes": []}
        if subtype is not None:
            courses[course.id]["subtypes"].append(subtype_ref(subtype))
    return list(courses.values())


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
    fee: Money | None = None


class SubtypePatch(SubtypeIn):
    name: Str(150) | None = None


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


def subtype_ref(s: CourseSubtype) -> dict:
    return {"id": s.id, "name": s.name, "fee": money(s.fee) if s.fee is not None else None}


def subtype_out(s: CourseSubtype) -> dict:
    return subtype_ref(s) | {"course_id": s.course_id, "is_active": s.is_active}


@router.get("/courses/{course_id}/subtypes")
def list_subtypes(course_id: int, active: bool | None = None, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    eligible = CourseSubtype.course_id == Course.id
    if active is not None:
        eligible &= CourseSubtype.is_active.is_(active)
    stmt = select(CourseSubtype).select_from(Course).outerjoin(CourseSubtype, eligible).where(
        Course.id == course_id, Course.deleted_at.is_(None)).order_by(CourseSubtype.name)
    rows = db.scalars(stmt).all()
    if not rows:
        raise not_found("course")
    return [subtype_out(s) for s in rows if s is not None]


@router.post("/courses/{course_id}/subtypes", status_code=201)
def create_subtype(course_id: int, body: SubtypeIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    c = get_course(db, course_id)
    _check_subtype_name(db, c.id, body.name)
    s = CourseSubtype(course_id=c.id, name=body.name, fee=body.fee, is_active=True)
    db.add(s)
    db.flush()
    audit(db, user.id, "COURSE_SUBTYPE_CREATED", "Course", c.code, f"Sub-type {body.name} added to {c.code}", after=subtype_out(s))
    db.commit()
    return subtype_out(s)


@router.patch("/course-subtypes/{subtype_id}")
def update_subtype(subtype_id: int, body: SubtypePatch, db: Session = Depends(get_db), user: CurrentUser = Depends(manage)):
    s = _subtype(db, subtype_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        if body.name is None:
            raise bad("FIELD_REQUIRED", "Enter a sub-type name.", "name")
        _check_subtype_name(db, s.course_id, body.name, s.id)
    before, after = apply_changes(s, changes)
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
    course_subtype_id: int | None = Field(None, gt=0)
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
    course_subtype_id: int | None = Field(None, gt=0)
    name: Str(120) | None = None
    start_time: time | None = None
    end_time: time | None = None
    days: Str(100) | None = None
    faculty: OptText = None
    capacity: int | None = Field(None, ge=1, le=1000)
    start_date: date | None = None
    end_date: date | None = None


def _slot(db: Session, slot_id: int, *, lock: bool = False) -> TimeSlot:
    s = db.get(TimeSlot, slot_id, with_for_update=lock or None)
    if s is None:
        raise not_found("time slot")
    return s


def _check_slot_assignment(db: Session, course_id: int, subtype_id: int | None) -> None:
    if subtype_id is None:
        return
    subtype = db.get(CourseSubtype, subtype_id, with_for_update={"read": True})
    if subtype is None or subtype.course_id != course_id or not subtype.is_active:
        raise bad("SUBTYPE_MISMATCH", "Choose an active sub-type of the selected course.", "course_subtype_id")


def _check_enrolled_students(db: Session, slot_id: int, subtype_id: int) -> None:
    selected_subtype = select(StudentCourseSubtype.student_id).where(
        StudentCourseSubtype.student_id == Student.id, StudentCourseSubtype.course_subtype_id == subtype_id,
    ).exists()
    incompatible = select(Student.id).where(
        Student.time_slot_id == slot_id, Student.course_subtype_id.is_distinct_from(subtype_id), ~selected_subtype,
    ).limit(1)
    if db.scalar(incompatible) is not None:
        raise AppError(409, "TIME_SLOT_SUBTYPE_IN_USE",
                       "This sub-type would exclude students assigned to this time slot.",
                       {"course_subtype_id": "Choose a sub-type shared by the assigned students or keep the slot course-wide."})


def _slot_columns(data: dict) -> dict:
    if "days" in data:
        data["days_of_week"] = data.pop("days")
    if "faculty" in data:
        data["faculty_name"] = data.pop("faculty")
    return data


@router.get("/time-slots")
def list_slots(course_id: int | None = None, active: bool | None = None, include_completed: bool = True,
               db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    counts = active_count_stmt(Student.time_slot_id, TimeSlot.id).scalar_subquery()
    stmt = select(TimeSlot, counts).options(joinedload(TimeSlot.course), joinedload(TimeSlot.course_subtype)).order_by(TimeSlot.start_time, TimeSlot.name)
    if course_id:
        stmt = stmt.where(TimeSlot.course_id == course_id)
    if active is not None:
        stmt = stmt.where(TimeSlot.is_active.is_(active))
    if not include_completed:
        stmt = stmt.where(TimeSlot.end_date.is_(None) | (TimeSlot.end_date >= today()))
    return [slot_out(s, count) | {"course": {"id": s.course.id, "code": s.course.code, "name": s.course.name}}
            for s, count in db.execute(stmt)]


@router.post("/time-slots", status_code=201)
def create_slot(body: SlotIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_slots)):
    c = get_course(db, body.course_id)
    if not c.is_active:
        raise AppError(400, "COURSE_INACTIVE", "Choose an active course.", {"course_id": "Choose an active course."})
    _check_slot_assignment(db, c.id, body.course_subtype_id)
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
    s = _slot(db, slot_id, lock=True)
    data = _slot_columns(body.model_dump(exclude_unset=True))
    subtype_id = data.get("course_subtype_id", s.course_subtype_id)
    SlotIn(course_id=s.course_id, course_subtype_id=subtype_id, name=data.get("name", s.name), start_time=data.get("start_time", s.start_time),
           end_time=data.get("end_time", s.end_time), days=data.get("days_of_week", s.days_of_week),
           faculty=data.get("faculty_name", s.faculty_name), capacity=data.get("capacity", s.capacity),
           start_date=data.get("start_date", s.start_date), end_date=data.get("end_date", s.end_date))
    if subtype_id is not None and subtype_id != s.course_subtype_id:
        _check_slot_assignment(db, s.course_id, subtype_id)
        _check_enrolled_students(db, s.id, subtype_id)
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
