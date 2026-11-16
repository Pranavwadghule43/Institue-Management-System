"""All 25 reports from one registry: shared filters, normalized columns, pagination, totals and Excel export.

PDF stays browser print (window.print) until a server PDF is approved, so no PDF endpoint is exposed.
"""
import io
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Callable, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..common import PAY_LABEL, PAY_MODES, ZERO, Paging, bounds, like, local_date, money, now, paging, today, user_names
from ..config import settings
from ..db import get_db
from ..errors import AppError, not_found
from ..ledger import fee_cols, series
from ..models import (
    AuditLog, Course, Customer, Expense, ExpenseCategory, FeeReceipt, Service, ServiceBill, ServiceBillItem, ServiceJob, ServiceJobEvent,
    ServiceJobItem, ServiceJobStaff, ServicePayment, Student, StudentInstallment, StudentPayment as P, TimeSlot, User,
)
from ..security import CurrentUser, require
from .academics import fmt_time
from .jobs import OPEN

router = APIRouter(prefix="/reports", tags=["reports"])


@dataclass
class F:
    date_from: date
    date_to: date
    course_id: int | None = None
    time_slot_id: int | None = None
    student_status: str | None = None
    fee_status: str | None = None
    staff_id: int | None = None
    service_id: int | None = None
    service_category_id: int | None = None
    expense_category_id: int | None = None
    job_status: str | None = None
    payment_mode: str | None = None
    q: str | None = None


@dataclass
class Report:
    slug: str
    name: str
    group: str
    desc: str
    cols: list[tuple[str, str, str]]  # key, label, kind: text|int|money|money_nosum|date|datetime
    build: Callable[[Session, F], list[dict]]
    filters: tuple[str, ...] = ()
    dated: bool = True  # uses date_from/date_to
    monthly: bool = False  # default range: last 12 months instead of 30 days
    perm: str | None = None  # extra permission beyond reports.view
    note: str | None = None


def _range(f: F):
    return bounds(f.date_from, f.date_to)


def _month_label(key: str) -> str:
    y, m = map(int, key.split("-"))
    return date(y, m, 1).strftime("%b %Y")


# ----------------------------------------------------------------- students & fees


def student_list(db, f):
    stmt = select(Student).options(joinedload(Student.course), joinedload(Student.time_slot)).where(Student.deleted_at.is_(None)).order_by(Student.student_code)
    if f.course_id:
        stmt = stmt.where(Student.course_id == f.course_id)
    if f.time_slot_id:
        stmt = stmt.where(Student.time_slot_id == f.time_slot_id)
    if f.student_status:
        stmt = stmt.where(Student.status == f.student_status)
    if f.q:
        stmt = stmt.where(or_(Student.full_name.ilike(like(f.q)), Student.student_code.ilike(like(f.q)), Student.mobile.like(like(f.q))))
    return [{"code": s.student_code, "name": s.full_name, "mobile": s.mobile, "course": s.course.code, "time_slot": s.time_slot.name,
             "status": s.status, "admission_date": s.admission_date} for s in db.scalars(stmt)]


def _paid_by_student():
    return select(StudentInstallment.student_id.label("sid"), func.sum(StudentInstallment.paid_amount).label("paid")).group_by(StudentInstallment.student_id).subquery()


def course_wise(db, f):
    paid = _paid_by_student()
    rows = db.execute(select(Course.name, Course.code,
                             func.count(Student.id).filter(Student.status == "Active"), func.count(Student.id),
                             func.coalesce(func.sum(Student.net_fee), 0), func.coalesce(func.sum(paid.c.paid), 0))
                      .outerjoin(Student, (Student.course_id == Course.id) & Student.deleted_at.is_(None)).outerjoin(paid, paid.c.sid == Student.id)
                      .where(Course.deleted_at.is_(None)).group_by(Course.id, Course.name, Course.code).order_by(Course.name)).all()
    return [{"course": n, "code": c, "active": a, "total": t, "net_fees": nf, "collected": col, "balance": nf - col} for n, c, a, t, nf, col in rows]


def batch_wise(db, f):
    counts = dict(db.execute(select(Student.time_slot_id, func.count()).where(Student.status == "Active", Student.deleted_at.is_(None)).group_by(Student.time_slot_id)).all())
    stmt = select(TimeSlot).options(joinedload(TimeSlot.course)).order_by(TimeSlot.start_time)
    if f.course_id:
        stmt = stmt.where(TimeSlot.course_id == f.course_id)
    return [{"time_slot": s.name, "course": s.course.code, "timing": f"{fmt_time(s.start_time)} – {fmt_time(s.end_time)}", "days": s.days_of_week,
             "faculty": s.faculty_name, "assigned": counts.get(s.id, 0), "capacity": s.capacity, "seats_left": s.capacity - counts.get(s.id, 0)}
            for s in db.scalars(stmt)]


def _payments(db, f, valid_only):
    start, end = _range(f)
    stmt = (select(P, Student, FeeReceipt.receipt_code).join(Student, Student.id == P.student_id).outerjoin(FeeReceipt, FeeReceipt.payment_id == P.id)
            .where(P.received_at >= start, P.received_at < end).order_by(P.received_at.desc()))
    if valid_only:
        stmt = stmt.where(P.status == "Valid")
    if f.payment_mode:
        stmt = stmt.where(P.payment_mode == f.payment_mode)
    if f.staff_id:
        stmt = stmt.where(P.collected_by == f.staff_id)
    if f.course_id:
        stmt = stmt.where(Student.course_id == f.course_id)
    rows = db.execute(stmt).all()
    return rows, user_names(db, [p.collected_by for p, *_ in rows])


def fee_collection(db, f):
    rows, names = _payments(db, f, True)
    return [{"receipt": rc, "date": p.received_at, "student_code": s.student_code, "student": s.full_name, "mode": PAY_LABEL[p.payment_mode],
             "collected_by": names.get(p.collected_by), "amount": p.amount} for p, s, rc in rows]


def pending_fee(db, f):
    t = today()
    c = fee_cols(t)
    stmt = c.join(select(Student, c.paid, c.balance, c.state, c.next_due)).options(joinedload(Student.course)).where(
        Student.status == "Active", Student.deleted_at.is_(None), c.balance > 0).order_by(c.balance.desc())
    if f.course_id:
        stmt = stmt.where(Student.course_id == f.course_id)
    if f.fee_status:
        stmt = stmt.where(c.state == f.fee_status)
    return [{"code": s.student_code, "student": s.full_name, "mobile": s.mobile, "course": s.course.code, "fee_state": state,
             "next_due": due, "net_fee": s.net_fee, "paid": paid, "balance": bal} for s, paid, bal, state, due in db.execute(stmt)]


def payment_history(db, f):
    rows, _ = _payments(db, f, False)
    return [{"receipt": rc, "date": p.received_at, "student": s.full_name, "mode": PAY_LABEL[p.payment_mode], "status": p.status,
             "amount": p.amount, "valid_amount": p.amount if p.status == "Valid" else ZERO, "reversal_reason": p.reversal_reason} for p, s, rc in rows]


def daily_collection(db, f):
    return [{"date": date.fromisoformat(d["key"]), "receipts": d["receipts"], "collected": d["fees"]} for d in reversed(series(db, f.date_from, f.date_to))]


# ----------------------------------------------------------------- finance


def expense_report(db, f):
    stmt = (select(Expense, ExpenseCategory.name).join(ExpenseCategory).where(Expense.deleted_at.is_(None), Expense.expense_date.between(f.date_from, f.date_to))
            .order_by(Expense.expense_date.desc(), Expense.id.desc()))
    if f.expense_category_id:
        stmt = stmt.where(Expense.category_id == f.expense_category_id)
    if f.payment_mode:
        stmt = stmt.where(Expense.payment_mode == f.payment_mode)
    rows = db.execute(stmt).all()
    names = user_names(db, [e.created_by for e, _ in rows])
    return [{"date": e.expense_date, "code": e.expense_code, "category": cat, "remark": e.description, "mode": PAY_LABEL[e.payment_mode],
             "added_by": names.get(e.created_by), "amount": e.amount} for e, cat in rows]


def _paid_bills(db, f):
    start, end = _range(f)
    stmt = (select(ServiceBill, Customer.full_name, ServiceJob.job_code, ServicePayment.payment_mode).join(Customer, Customer.id == ServiceBill.customer_id)
            .join(ServiceJob, ServiceJob.id == ServiceBill.job_id).join(ServicePayment, ServicePayment.bill_id == ServiceBill.id)
            .where(ServiceBill.status == "Paid", ServiceBill.paid_at >= start, ServiceBill.paid_at < end).order_by(ServiceBill.paid_at.desc()))
    if f.payment_mode:
        stmt = stmt.where(ServicePayment.payment_mode == f.payment_mode)
    if f.staff_id:
        stmt = stmt.where(ServiceBill.paid_by == f.staff_id)
    return db.execute(stmt).all()


def service_income(db, f):
    rows = _paid_bills(db, f)
    names = user_names(db, [b.paid_by for b, *_ in rows])
    return [{"bill": b.bill_code, "paid_on": b.paid_at, "customer": c, "job": j, "mode": PAY_LABEL[m], "paid_by": names.get(b.paid_by), "amount": b.grand_total}
            for b, c, j, m in rows]


def daily_cash(db, f):
    return [{"date": date.fromisoformat(d["key"]), "fees": d["fees"], "services": d["services"], "expenses": d["expenses"], "net": d["net"]}
            for d in reversed(series(db, f.date_from, f.date_to))]


def monthly_income(db, f):
    return [{"month": _month_label(m["key"]), "fees": m["fees"], "services": m["services"], "total": m["income"]} for m in reversed(series(db, f.date_from, f.date_to, "month"))]


def pnl(db, f):
    return [{"month": _month_label(m["key"]), "income": m["income"], "expenses": m["expenses"], "net": m["net"]} for m in reversed(series(db, f.date_from, f.date_to, "month"))]


# ----------------------------------------------------------------- staff & audit


def _users(db):
    return db.execute(select(User.id, User.full_name, User.role).where(User.deleted_at.is_(None)).order_by(User.role, User.full_name)).all()


def staff_collection(db, f):
    start, end = _range(f)
    agg = dict((uid, (n, a)) for uid, n, a in db.execute(select(P.collected_by, func.count(), func.sum(P.amount)).where(
        P.status == "Valid", P.received_at >= start, P.received_at < end).group_by(P.collected_by)))
    return [{"staff": name, "role": "Admin" if role == "ADMIN" else "Staff", "receipts": agg.get(uid, (0, ZERO))[0], "collected": agg.get(uid, (0, ZERO))[1]}
            for uid, name, role in _users(db) if not f.staff_id or uid == f.staff_id]


def _audit(db, f, actions: str | None = None):
    start, end = _range(f)
    stmt = select(AuditLog).where(AuditLog.created_at >= start, AuditLog.created_at < end).order_by(AuditLog.created_at.desc())
    if f.staff_id:
        stmt = stmt.where(AuditLog.actor_id == f.staff_id)
    if actions:
        stmt = stmt.where(or_(*[AuditLog.action.like(f"%{a}%") for a in actions.split("|")]))
    rows = db.scalars(stmt).all()
    names = user_names(db, [a.actor_id for a in rows])
    return [{"when": a.created_at, "staff": names.get(a.actor_id, "System"), "action": a.action, "entity": a.entity_type, "record": a.entity_id,
             "details": a.summary, "reason": a.reason} for a in rows]


# ----------------------------------------------------------------- services


def daily_service(db, f):
    start, end = _range(f)
    received = defaultdict(int)
    for (d,) in db.execute(select(ServiceJob.service_date).where(ServiceJob.service_date.between(f.date_from, f.date_to))):
        received[d] += 1
    completed = defaultdict(int)
    for (at,) in db.execute(select(ServiceJobEvent.created_at).where(ServiceJobEvent.new_status == "Completed", ServiceJobEvent.created_at >= start, ServiceJobEvent.created_at < end)):
        completed[local_date(at)] += 1
    out = []
    for d in reversed(series(db, f.date_from, f.date_to)):
        day = date.fromisoformat(d["key"])
        out.append({"date": day, "received": received[day], "completed": completed[day], "revenue": d["services"]})
    return out


def monthly_service(db, f):
    return [{"month": _month_label(m["key"]), "bills": m["bills"], "revenue": m["services"]} for m in reversed(series(db, f.date_from, f.date_to, "month"))]


def service_revenue(db, f):
    start, end = _range(f)
    stmt = (select(ServiceBillItem.service_name_snapshot, func.count(), func.sum(ServiceBillItem.quantity), func.sum(ServiceBillItem.line_amount))
            .join(ServiceBill, ServiceBill.id == ServiceBillItem.bill_id).outerjoin(Service, Service.id == ServiceBillItem.service_id)
            .where(ServiceBill.status == "Paid", ServiceBill.paid_at >= start, ServiceBill.paid_at < end)
            .group_by(ServiceBillItem.service_name_snapshot).order_by(func.sum(ServiceBillItem.line_amount).desc()))
    if f.service_id:
        stmt = stmt.where(ServiceBillItem.service_id == f.service_id)
    if f.service_category_id:
        stmt = stmt.where(Service.category_id == f.service_category_id)
    return [{"service": n, "times_billed": c, "quantity": q, "gross_revenue": a} for n, c, q, a in db.execute(stmt)]


def customer_history(db, f):
    jobs = select(ServiceJob.customer_id.label("cid"), func.count().label("jobs"), func.max(ServiceJob.service_date).label("last")).group_by(ServiceJob.customer_id).subquery()
    paid = select(ServiceBill.customer_id.label("cid"), func.sum(ServiceBill.grand_total).label("paid")).where(ServiceBill.status == "Paid").group_by(ServiceBill.customer_id).subquery()
    stmt = (select(Customer, jobs.c.jobs, jobs.c.last, paid.c.paid).outerjoin(jobs, jobs.c.cid == Customer.id).outerjoin(paid, paid.c.cid == Customer.id)
            .where(Customer.deleted_at.is_(None)).order_by(func.coalesce(paid.c.paid, 0).desc(), Customer.full_name))
    if f.q:
        stmt = stmt.where(or_(Customer.full_name.ilike(like(f.q)), Customer.customer_code.ilike(like(f.q)), Customer.mobile.like(like(f.q))))
    return [{"code": c.customer_code, "customer": c.full_name, "mobile": c.mobile, "jobs": j or 0, "last_visit": last, "paid": p or ZERO}
            for c, j, last, p in db.execute(stmt)]


def _job_rows(db, stmt):
    jobs = db.scalars(stmt.options(selectinload(ServiceJob.items).selectinload(ServiceJobItem.service), joinedload(ServiceJob.customer))).all()
    staff = defaultdict(list)
    for jid, name in db.execute(select(ServiceJobStaff.job_id, User.full_name).join(User).where(ServiceJobStaff.job_id.in_([j.id for j in jobs]))):
        staff[jid].append(name)
    return jobs, staff


def pending_jobs(db, f):
    t = today()
    stmt = select(ServiceJob).where(ServiceJob.status.in_((f.job_status,) if f.job_status in OPEN else OPEN)).order_by(ServiceJob.service_date, ServiceJob.id)
    if f.staff_id:
        stmt = stmt.where(exists().where(ServiceJobStaff.job_id == ServiceJob.id, ServiceJobStaff.user_id == f.staff_id))
    jobs, staff = _job_rows(db, stmt)
    return [{"job": j.job_code, "customer": j.customer.full_name, "services": ", ".join(i.service.name for i in j.items), "status": j.status,
             "service_date": j.service_date, "days_open": max(0, (t - j.service_date).days), "assigned": ", ".join(staff[j.id])} for j in jobs]


def completed_jobs(db, f):
    start, end = _range(f)
    stmt = select(ServiceJob).where(ServiceJob.status == "Completed", ServiceJob.completed_at >= start, ServiceJob.completed_at < end).order_by(ServiceJob.completed_at.desc())
    if f.staff_id:
        stmt = stmt.where(exists().where(ServiceJobStaff.job_id == ServiceJob.id, ServiceJobStaff.user_id == f.staff_id))
    jobs, staff = _job_rows(db, stmt)
    return [{"job": j.job_code, "customer": j.customer.full_name, "services": ", ".join(i.service.name for i in j.items), "completed": j.completed_at,
             "assigned": ", ".join(staff[j.id])} for j in jobs]


def staff_service(db, f):
    rows = db.execute(select(ServiceJobStaff.user_id, ServiceJob.status, func.count()).join(ServiceJob).group_by(ServiceJobStaff.user_id, ServiceJob.status)).all()
    agg = defaultdict(lambda: {"open": 0, "completed": 0, "total": 0})
    for uid, status, n in rows:
        agg[uid]["total"] += n
        if status in OPEN:
            agg[uid]["open"] += n
        elif status == "Completed":
            agg[uid]["completed"] += n
    return [{"staff": name, "open": agg[uid]["open"], "completed": agg[uid]["completed"], "total": agg[uid]["total"]}
            for uid, name, _ in _users(db) if not f.staff_id or uid == f.staff_id]


def service_payment(db, f):
    rows = _paid_bills(db, f)
    agg = {m: [0, ZERO] for m in PAY_MODES}
    for b, _, _, m in rows:
        agg[m][0] += 1
        agg[m][1] += b.grand_total
    return [{"mode": PAY_LABEL[m], "bills": n, "amount": a} for m, (n, a) in agg.items()]


def cancelled_bills(db, f):
    start, end = _range(f)
    rows = db.execute(select(ServiceBill, Customer.full_name, ServiceJob.job_code).join(Customer, Customer.id == ServiceBill.customer_id)
                      .join(ServiceJob, ServiceJob.id == ServiceBill.job_id)
                      .where(ServiceBill.status == "Cancelled", ServiceBill.cancelled_at >= start, ServiceBill.cancelled_at < end)
                      .order_by(ServiceBill.cancelled_at.desc())).all()
    paid = set(db.scalars(select(ServicePayment.bill_id).where(ServicePayment.bill_id.in_([b.id for b, *_ in rows]))))
    names = user_names(db, [b.cancelled_by for b, *_ in rows])
    return [{"bill": b.bill_code, "customer": c, "job": j, "reason": b.cancellation_reason, "was_paid": "Yes" if b.id in paid else "No",
             "amount": b.grand_total, "cancelled_by": names.get(b.cancelled_by), "cancelled_at": b.cancelled_at} for b, c, j in rows]


def service_profit(db, f):
    # Cost rule not confirmed (C-46): revenue only; cost and profit stay null.
    return [{"month": _month_label(m["key"]), "revenue": m["services"], "cost": None, "profit": None, "calculation_status": "pending_cost_rule"}
            for m in reversed(series(db, f.date_from, f.date_to, "month"))]


# ----------------------------------------------------------------- registry

T, I, M, N, D, DT = "text", "int", "money", "money_nosum", "date", "datetime"
REPORTS = {r.slug: r for r in [
    Report("student-list", "Student list", "Students & fees", "All students with course, time slot and status",
           [("code", "Student ID", T), ("name", "Name", T), ("mobile", "Mobile", T), ("course", "Course", T), ("time_slot", "Batch / Time slot", T),
            ("status", "Status", T), ("admission_date", "Admitted", D)], student_list, ("course_id", "time_slot_id", "student_status", "q"), dated=False),
    Report("course-wise", "Course-wise students", "Students & fees", "Enrolment and fee totals per course",
           [("course", "Course", T), ("code", "Code", T), ("active", "Active", I), ("total", "Total", I), ("net_fees", "Net fees", M),
            ("collected", "Collected", M), ("balance", "Balance", M)], course_wise, dated=False),
    Report("batch-wise", "Batch-wise students", "Students & fees", "Seats filled per time slot",
           [("time_slot", "Time slot", T), ("course", "Course", T), ("timing", "Timing", T), ("days", "Days", T), ("faculty", "Faculty", T),
            ("assigned", "Students", I), ("capacity", "Capacity", I), ("seats_left", "Seats left", I)], batch_wise, ("course_id",), dated=False),
    Report("fee-collection", "Fee collection", "Students & fees", "Valid (non-reversed) payments in the period",
           [("receipt", "Receipt", T), ("date", "Date", DT), ("student_code", "Student ID", T), ("student", "Student", T), ("mode", "Mode", T),
            ("collected_by", "Collected by", T), ("amount", "Amount", M)], fee_collection, ("payment_mode", "staff_id", "course_id")),
    Report("pending-fee", "Pending fee", "Students & fees", "Active students with an outstanding balance",
           [("code", "Student ID", T), ("student", "Student", T), ("mobile", "Mobile", T), ("course", "Course", T), ("fee_state", "Fee state", T),
            ("next_due", "Next due", D), ("net_fee", "Net fee", M), ("paid", "Paid", M), ("balance", "Balance", M)], pending_fee, ("course_id", "fee_status"), dated=False),
    Report("payment-history", "Payment history", "Students & fees", "Every payment including reversals",
           [("receipt", "Receipt", T), ("date", "Date", DT), ("student", "Student", T), ("mode", "Mode", T), ("status", "Status", T),
            ("amount", "Amount", N), ("valid_amount", "Valid amount", M), ("reversal_reason", "Reversal reason", T)], payment_history, ("payment_mode", "staff_id", "course_id")),
    Report("daily-collection", "Daily collection", "Finance", "Day-by-day student fee totals",
           [("date", "Date", D), ("receipts", "Receipts", I), ("collected", "Collected", M)], daily_collection),
    Report("expense", "Expense report", "Finance", "Expenses with category and mode",
           [("date", "Date", D), ("code", "Expense ID", T), ("category", "Category", T), ("remark", "Remark", T), ("mode", "Mode", T),
            ("added_by", "Added by", T), ("amount", "Amount", M)], expense_report, ("expense_category_id", "payment_mode")),
    Report("service-income", "Service income", "Finance", "Paid, non-cancelled service bills in the period",
           [("bill", "Bill", T), ("paid_on", "Paid on", DT), ("customer", "Customer", T), ("job", "Job", T), ("mode", "Mode", T),
            ("paid_by", "Received by", T), ("amount", "Amount", M)], service_income, ("payment_mode", "staff_id")),
    Report("daily-cash", "Daily cash", "Finance", "Fees + paid services - expenses per day",
           [("date", "Date", D), ("fees", "Fees", M), ("services", "Services", M), ("expenses", "Expenses", M), ("net", "Net", M)], daily_cash),
    Report("monthly-income", "Monthly income", "Finance", "Fee and service income by month",
           [("month", "Month", T), ("fees", "Fees", M), ("services", "Services", M), ("total", "Total", M)], monthly_income, monthly=True),
    Report("pnl", "Profit & loss", "Finance", "Income, expenses and net by month",
           [("month", "Month", T), ("income", "Income", M), ("expenses", "Expenses", M), ("net", "Net", M)], pnl, monthly=True),
    Report("staff-collection", "Staff-wise collection", "Staff & audit", "Fee receipts and totals by collecting staff",
           [("staff", "Staff", T), ("role", "Role", T), ("receipts", "Receipts", I), ("collected", "Collected", M)], staff_collection, ("staff_id",)),
    Report("staff-activity", "Staff activity", "Staff & audit", "Actions recorded in the audit log",
           [("when", "When", DT), ("staff", "Staff", T), ("action", "Action", T), ("entity", "Entity", T), ("record", "Record", T), ("details", "Details", T)],
           lambda db, f: _audit(db, f), ("staff_id",), perm="audit.view"),
    Report("deleted-records", "Deleted records", "Staff & audit", "Deletions, reversals, cancellations and archives",
           [("when", "When", DT), ("staff", "Staff", T), ("action", "Action", T), ("entity", "Entity", T), ("record", "Record", T),
            ("details", "Details", T), ("reason", "Reason", T)], lambda db, f: _audit(db, f, "DELETED|REVERSED|CANCELLED|ARCHIVED"), ("staff_id",), perm="audit.view"),
    Report("daily-service", "Daily service", "Services", "Jobs received and completed, and service revenue per day",
           [("date", "Date", D), ("received", "Received", I), ("completed", "Completed", I), ("revenue", "Revenue", M)], daily_service),
    Report("monthly-service", "Monthly service", "Services", "Valid service revenue by month",
           [("month", "Month", T), ("bills", "Paid bills", I), ("revenue", "Revenue", M)], monthly_service, monthly=True),
    Report("service-revenue", "Service-wise revenue", "Services", "Gross item revenue (quantity x rate) per service",
           [("service", "Service", T), ("times_billed", "Times billed", I), ("quantity", "Quantity", I), ("gross_revenue", "Gross revenue", M)],
           service_revenue, ("service_id", "service_category_id"), note="Gross item revenue; bill-level discounts are not allocated to items."),
    Report("customer-history", "Customer-wise service history", "Services", "Jobs and paid bill totals per customer",
           [("code", "Customer ID", T), ("customer", "Customer", T), ("mobile", "Mobile", T), ("jobs", "Jobs", I), ("last_visit", "Last visit", D),
            ("paid", "Paid", M)], customer_history, ("q",), dated=False),
    Report("pending-jobs", "Pending service jobs", "Services", "Open jobs, oldest first",
           [("job", "Job", T), ("customer", "Customer", T), ("services", "Services", T), ("status", "Status", T), ("service_date", "Service date", D),
            ("days_open", "Days open", I), ("assigned", "Assigned", T)], pending_jobs, ("staff_id", "job_status"), dated=False),
    Report("completed-jobs", "Completed service jobs", "Services", "Jobs completed in the period",
           [("job", "Job", T), ("customer", "Customer", T), ("services", "Services", T), ("completed", "Completed", DT), ("assigned", "Assigned", T)],
           completed_jobs, ("staff_id",)),
    Report("staff-service", "Staff-wise service", "Services", "Open, completed and total assigned jobs per staff",
           [("staff", "Staff", T), ("open", "Open", I), ("completed", "Completed", I), ("total", "Total", I)], staff_service, ("staff_id",), dated=False),
    Report("service-payment", "Service payment", "Services", "Paid bills by payment mode",
           [("mode", "Mode", T), ("bills", "Bills", I), ("amount", "Amount", M)], service_payment),
    Report("cancelled-bills", "Cancelled service bills", "Services", "Cancelled bills with reasons",
           [("bill", "Bill", T), ("customer", "Customer", T), ("job", "Job", T), ("reason", "Reason", T), ("was_paid", "Was paid", T),
            ("amount", "Amount", M), ("cancelled_by", "Cancelled by", T), ("cancelled_at", "Cancelled at", DT)], cancelled_bills),
    Report("service-profit", "Service profit", "Services", "Revenue less service cost (cost rule pending)",
           [("month", "Month", T), ("revenue", "Revenue", M), ("cost", "Cost", N), ("profit", "Profit", N), ("calculation_status", "Status", T)],
           service_profit, monthly=True, note="Service cost rule is pending (C-46); cost and profit are not calculated."),
]}


def _filters(r: Report, date_from, date_to, **kw) -> F:
    t = today()
    if r.monthly:
        default_from = (t.replace(day=1) - timedelta(days=330)).replace(day=1)
    else:
        default_from = t - timedelta(days=29)
    f = F(date_from=date_from or default_from, date_to=date_to or t, **{k: v for k, v in kw.items() if k in r.filters})
    if f.date_to < f.date_from:
        raise AppError(400, "INVALID_RANGE", "The end date can't be before the start date.", {"date_to": "Invalid range"})
    if (f.date_to - f.date_from).days > 3660:
        raise AppError(400, "RANGE_TOO_LARGE", "Choose a range of 10 years or less.", {"date_from": "Range too large"})
    return f


def _cell(v, kind):
    if v is None:
        return None
    if kind in (M, N):
        return money(v)
    return v


def _run(r: Report, db: Session, user: CurrentUser, f: F) -> tuple[list[dict], dict]:
    if r.perm and not user.can(r.perm):
        raise AppError(403, "FORBIDDEN", "You do not have permission for this report.")
    rows = r.build(db, f)
    totals = {k: sum((x[k] or ZERO for x in rows), ZERO) for k, _, kind in r.cols if kind == M}  # money columns only, like the UI footer
    return rows, totals


def _meta(r: Report) -> dict:
    return {"slug": r.slug, "name": r.name, "group": r.group, "description": r.desc, "note": r.note,
            "columns": [{"key": k, "label": label, "type": "money" if kind in (M, N) else kind} for k, label, kind in r.cols],
            "filters": (["date_from", "date_to"] if r.dated else []) + list(r.filters), "exports": ["xlsx"]}


class ReportQuery:
    def __init__(self, date_from: date | None = None, date_to: date | None = None, course_id: int | None = None, time_slot_id: int | None = None,
                 student_status: Literal["Active", "Completed", "Left"] | None = None,
                 fee_status: Literal["Overdue", "Due Today", "Due Tomorrow", "On Track"] | None = None, staff_id: int | None = None,
                 service_id: int | None = None, service_category_id: int | None = None, expense_category_id: int | None = None,
                 job_status: Literal["Pending", "In Process", "On Hold"] | None = None,
                 payment_mode: Literal["Cash", "GPay", "PhonePe", "UPI", "Card", "Bank"] | None = None, q: str | None = Query(None, max_length=100)):
        self.date_from, self.date_to = date_from, date_to
        self.kw = dict(course_id=course_id, time_slot_id=time_slot_id, student_status=student_status, fee_status=fee_status, staff_id=staff_id,
                       service_id=service_id, service_category_id=service_category_id, expense_category_id=expense_category_id,
                       job_status=job_status, payment_mode=payment_mode, q=q)


def _report(slug: str) -> Report:
    r = REPORTS.get(slug)
    if r is None:
        raise not_found("report")
    return r


@router.get("")
def catalog(user: CurrentUser = Depends(require("reports.view"))):
    return [_meta(r) for r in REPORTS.values() if not r.perm or user.can(r.perm)]


@router.get("/{slug}")
def run_report(slug: str, rq: ReportQuery = Depends(), p: Paging = Depends(paging), db: Session = Depends(get_db),
               user: CurrentUser = Depends(require("reports.view"))):
    r = _report(slug)
    f = _filters(r, rq.date_from, rq.date_to, **rq.kw)
    rows, totals = _run(r, db, user, f)
    # ponytail: rows are built in full then sliced; report volumes for one institute are small. Move to SQL paging if a report grows past ~50k rows.
    page = rows[(p.page - 1) * p.page_size: p.page * p.page_size]
    kinds = {k: kind for k, _, kind in r.cols}
    return _meta(r) | {
        "applied_filters": {"date_from": f.date_from, "date_to": f.date_to} | {k: v for k, v in rq.kw.items() if v is not None and k in r.filters},
        "items": [{k: _cell(v, kinds.get(k, T)) for k, v in row.items()} for row in page],
        "totals": {k: money(v) for k, v in totals.items()},
        "page": p.page, "page_size": p.page_size, "total": len(rows), "pages": -(-len(rows) // p.page_size), "generated_at": now()}


@router.get("/{slug}/export.xlsx")
def export_xlsx(slug: str, rq: ReportQuery = Depends(), db: Session = Depends(get_db), user: CurrentUser = Depends(require("reports.view"))):
    r = _report(slug)
    f = _filters(r, rq.date_from, rq.date_to, **rq.kw)
    rows, totals = _run(r, db, user, f)
    wb = Workbook()
    ws = wb.active
    ws.title = r.name[:31]
    ws.append([r.name])
    ws["A1"].font = Font(bold=True, size=14)
    applied = {k: v for k, v in rq.kw.items() if v is not None and k in r.filters}
    ws.append(["Period", f"{f.date_from.isoformat()} to {f.date_to.isoformat()}"] if r.dated else ["Period", "Current state"])
    if applied:
        ws.append(["Filters", ", ".join(f"{k}={v}" for k, v in applied.items())])
    ws.append(["Generated", datetime.now(settings.tz).strftime("%Y-%m-%d %H:%M") + f" by {user.full_name}"])
    if r.note:
        ws.append(["Note", r.note])
    ws.append([])
    ws.append([label for _, label, _ in r.cols])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)
    for row in rows:
        out = []
        for k, _, _kind in r.cols:
            v = row.get(k)
            if isinstance(v, datetime):
                v = v.astimezone(settings.tz).replace(tzinfo=None)  # Excel has no time zones: show institute-local time
            out.append(float(v) if isinstance(v, Decimal) else v)  # Excel cells are numeric; money keeps 2dp via number_format
        ws.append(out)
        for c, (_, _, kind) in zip(ws[ws.max_row], r.cols):
            if kind in (M, N):
                c.number_format = "#,##0.00"
            elif kind == DT:
                c.number_format = "yyyy-mm-dd hh:mm"
            elif kind == D:
                c.number_format = "yyyy-mm-dd"
    if totals:
        ws.append([("Total" if i == 0 else float(totals[k]) if k in totals else None) for i, (k, _, _) in enumerate(r.cols)])
        for c, (_, _, kind) in zip(ws[ws.max_row], r.cols):
            c.font = Font(bold=True)
            if kind == M:
                c.number_format = "#,##0.00"
    for row in ws.iter_rows():  # QA-10: the export never writes formulas, so user text starting with '=' stays text
        for c in row:
            if c.data_type == "f":
                c.data_type = "s"
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    filename = f"{r.slug}-{today().isoformat()}.xlsx"
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
