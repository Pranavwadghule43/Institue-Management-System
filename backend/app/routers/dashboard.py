"""Admin dashboard, Staff "My counter", global search, sidebar counts and notifications."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..common import PAY_LABEL, ZERO, bounds, like, money, one_trip, today, user_ref
from ..db import get_db
from ..ledger import fee_cols, money_dict, series, totals_from, totals_stmts
from ..models import (
    AuditLog, Customer, Enquiry, Expense, FeeReceipt, ServiceBill, ServiceJob, ServiceJobEvent, ServiceJobStaff, ServicePayment, Student,
    StudentPayment as P, User,
)
from ..security import CurrentUser, get_current_user, me_payload, require
from .jobs import OPEN, jobs_payload
from .students import search_filter

router = APIRouter(tags=["dashboard"])


def followups(db: Session, limit: int) -> list[dict]:
    t = today()
    f = fee_cols(t)
    rows = db.execute(f.join(select(Student, f.next_due, f.next_remaining, f.balance)).options(joinedload(Student.course))
                      .where(Student.status == "Active", Student.deleted_at.is_(None), f.state.in_(("Overdue", "Due Today")))
                      .order_by(f.next_due, Student.id).limit(limit)).all()
    return [{"code": s.student_code, "name": s.full_name, "mobile": s.mobile, "whatsapp_number": s.whatsapp_number or s.mobile,
             "course_code": s.course.code, "due_date": due,
             "installment_due": money(rem), "balance": money(bal), "overdue_days": (t - due).days} for s, due, rem, bal in rows]


def fee_state_count_stmt(states: tuple[str, ...]):
    f = fee_cols(today())
    return select(func.count()).select_from(
        f.join(select(Student.id)).where(Student.status == "Active", Student.deleted_at.is_(None), f.state.in_(states)).subquery())


def recent_audit(db: Session, limit: int, actor_id: int | None = None) -> list[dict]:
    stmt = select(AuditLog, User.full_name).outerjoin(User, User.id == AuditLog.actor_id).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    return [{"at": a.created_at, "action": a.action, "summary": a.summary, "entity_type": a.entity_type, "entity_id": a.entity_id,
             "by": user_ref({a.actor_id: name} if name is not None else {}, a.actor_id)} for a, name in db.execute(stmt)]


@router.get("/dashboard/admin")
def admin_dashboard(trend_days: int = Query(14, ge=1, le=90), db: Session = Depends(get_db), user: CurrentUser = Depends(require("reports.view"))):
    t = today()
    yesterday = t - timedelta(days=1)
    live = Student.deleted_at.is_(None)
    f = fee_cols(t)
    start, end = bounds(t, t)
    # Every single-number figure on this page in ONE round trip (performance); each statement is unchanged.
    (pending, unpaid_count, unpaid_sum, total_students, active_students, admissions_today, admissions_month, overdue_students,
     completed_today, *money_today_yesterday) = one_trip(
        db,
        f.join(select(func.coalesce(func.sum(f.balance), 0)).select_from(Student)).where(live, Student.status == "Active"),
        select(func.count()).where(ServiceBill.status == "Unpaid"),
        select(func.coalesce(func.sum(ServiceBill.grand_total), 0)).where(ServiceBill.status == "Unpaid"),
        select(func.count()).where(live),
        select(func.count()).where(live, Student.status == "Active"),
        select(func.count()).where(live, Student.admission_date == t),
        select(func.count()).where(live, Student.admission_date >= t.replace(day=1)),
        fee_state_count_stmt(("Overdue",)),
        select(func.count(func.distinct(ServiceJobEvent.job_id))).where(
            ServiceJobEvent.new_status == "Completed", ServiceJobEvent.created_at >= start, ServiceJobEvent.created_at < end),
        *totals_stmts(t, t), *totals_stmts(yesterday, yesterday),
    )
    now_, prev = totals_from(*money_today_yesterday[:3]), totals_from(*money_today_yesterday[3:])
    last = db.execute(select(P, FeeReceipt.receipt_code, User.full_name).join(FeeReceipt, FeeReceipt.payment_id == P.id)
                      .outerjoin(User, User.id == P.collected_by)
                      .where(P.status == "Valid", P.received_at >= start, P.received_at < end).order_by(P.received_at.desc()).limit(1)).first()
    jobs = dict(db.execute(select(ServiceJob.status, func.count()).group_by(ServiceJob.status)).all())
    return {
        "kpis": {
            "total_students": total_students,
            "active_students": active_students,
            "admissions_today": admissions_today,
            "pending_fees": money(pending),
            "fee_collection_today": money(now_["fees"]), "service_income_today": money(now_["services"]),
            "expenses_today": money(now_["expenses"]), "net_income_today": money(now_["net"]),
        },
        "admissions_this_month": admissions_month,
        "overdue_students": overdue_students or 0,
        "last_receipt": None if last is None else {"receipt_no": last[1], "at": last[0].received_at, "amount": money(last[0].amount),
                                                   "by": user_ref({last[0].collected_by: last[2]} if last[2] is not None else {}, last[0].collected_by)},
        "trend": [money_dict(d) for d in series(db, t - timedelta(days=trend_days - 1), t, "day")],
        "service_status_counts": {s: jobs.get(s, 0) for s in ("Pending", "In Process", "On Hold", "Completed", "Cancelled")},
        "service_desk": {
            "completed_today": completed_today,
            "unpaid_bills": unpaid_count, "pending_amount": money(unpaid_sum)},
        "fee_followups": followups(db, 8),
        "recent_activity": recent_audit(db, 5) if user.can("audit.view") else [],
        "comparisons": {"today": money_dict(now_), "yesterday": money_dict(prev)},
    }


@router.get("/dashboard/me")
def my_dashboard(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """Always the signed-in user's own counter; no staff ID is accepted from the browser."""
    t = today()
    start, end = bounds(t, t)
    pays = db.execute(select(P, Student.full_name, FeeReceipt.receipt_code).join(Student, Student.id == P.student_id).outerjoin(FeeReceipt, FeeReceipt.payment_id == P.id)
                      .where(P.collected_by == user.id, P.status == "Valid", P.received_at >= start, P.received_at < end).order_by(P.received_at.desc())).all()
    bills = db.execute(select(ServiceBill.grand_total, ServicePayment.payment_mode).join(ServicePayment, ServicePayment.bill_id == ServiceBill.id)
                       .where(ServiceBill.paid_by == user.id, ServiceBill.status == "Paid", ServiceBill.paid_at >= start, ServiceBill.paid_at < end)).all()
    cash_exp = db.scalar(select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.created_by == user.id, Expense.deleted_at.is_(None),
                                                                                Expense.expense_date == t, Expense.payment_mode == "Cash")) or ZERO
    done = db.scalar(select(func.count(func.distinct(ServiceJobEvent.job_id))).where(ServiceJobEvent.actor_id == user.id, ServiceJobEvent.new_status == "Completed",
                                                                                   ServiceJobEvent.created_at >= start, ServiceJobEvent.created_at < end))
    mine = exists().where(ServiceJobStaff.job_id == ServiceJob.id, ServiceJobStaff.user_id == user.id)
    open_jobs = db.scalars(select(ServiceJob).where(mine, ServiceJob.status.in_(OPEN)).order_by(ServiceJob.due_date.nulls_last(), ServiceJob.id).limit(20)).all()
    cash = sum((p.amount for p, *_ in pays if p.payment_mode == "Cash"), ZERO) + sum((amt for amt, mode in bills if mode == "Cash"), ZERO) - cash_exp
    return {
        "user": me_payload(user),
        "fees_collected_today": {"amount": money(sum((p.amount for p, *_ in pays), ZERO)), "receipts": len(pays)},
        "bills_closed_today": {"amount": money(sum((amt for amt, _ in bills), ZERO)), "count": len(bills)},
        "jobs_completed_today": done, "open_assigned_jobs": len(open_jobs),
        "cash_to_hand_over": money(cash),
        "assigned_jobs": jobs_payload(db, open_jobs),
        "fee_followups": followups(db, 6) if user.can("reminders.view") else [],
        "receipts_today": [{"receipt_no": rc, "student": name, "at": p.received_at, "mode": p.payment_mode, "mode_label": PAY_LABEL[p.payment_mode],
                            "amount": money(p.amount)} for p, name, rc in pays[:6]],
        "recent_entries": recent_audit(db, 6, user.id),
    }


@router.get("/search")
def global_search(q: str = Query(min_length=2, max_length=100), db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """Ctrl+K palette: each group only appears when the user may see it."""
    pat, digits = like(q), q.replace(" ", "")
    out: dict[str, list] = {}
    if user.can("students.view"):
        rows = db.scalars(select(Student).options(joinedload(Student.course)).where(Student.deleted_at.is_(None), search_filter(q)).limit(5)).all()
        out["students"] = [{"code": s.student_code, "label": s.full_name, "sub": f"{s.student_code} · {s.course.code} · {s.mobile}"} for s in rows]
        rows = db.scalars(select(Enquiry).where(or_(Enquiry.enquiry_code.ilike(pat), Enquiry.student_name.ilike(pat), Enquiry.mobile.like(like(digits)))).limit(5)).all()
        out["enquiries"] = [{"code": e.enquiry_code, "label": e.student_name, "sub": f"{e.enquiry_code} · {e.status}"} for e in rows]
    if user.can("customers.view"):
        rows = db.scalars(select(Customer).where(Customer.deleted_at.is_(None), or_(Customer.full_name.ilike(pat), Customer.customer_code.ilike(pat), Customer.mobile.like(like(digits)))).limit(5)).all()
        out["customers"] = [{"code": c.customer_code, "label": c.full_name, "sub": f"{c.customer_code} · {c.mobile}"} for c in rows]
    if user.can("service_jobs.view"):
        rows = db.execute(select(ServiceJob, Customer.full_name).join(Customer).where(or_(ServiceJob.job_code.ilike(pat), Customer.full_name.ilike(pat), ServiceJob.application_name.ilike(pat))).limit(5)).all()
        out["service_jobs"] = [{"code": j.job_code, "label": j.job_code, "sub": f"{name} · {j.status}"} for j, name in rows]
    if user.can("receipts.view_print"):
        rows = db.execute(select(FeeReceipt.receipt_code, Student.full_name).join(Student, Student.id == FeeReceipt.student_id).where(FeeReceipt.receipt_code.ilike(pat)).limit(5)).all()
        out["receipts"] = [{"code": rc, "label": rc, "sub": name} for rc, name in rows]
    if user.can("service_bill.create"):
        rows = db.execute(select(ServiceBill.bill_code, Customer.full_name, ServiceBill.status).join(Customer).where(ServiceBill.bill_code.ilike(pat)).limit(5)).all()
        out["service_bills"] = [{"code": bc, "label": bc, "sub": f"{name} · {st}"} for bc, name, st in rows]
    return out


def _counts(db: Session, wanted: dict) -> dict:
    """{name: count statement} -> {name: value}, all in one round trip (empty dict -> no query)."""
    return dict(zip(wanted, one_trip(db, *wanted.values()))) if wanted else {}


@router.get("/meta/sidebar")
def sidebar(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """Badge counts for the navigation (null when the user can't see that module)."""
    wanted = {}
    if user.can("fees.view"):
        wanted["fee_reminders"] = fee_state_count_stmt(("Overdue", "Due Today"))
    if user.can("service_jobs.view"):
        wanted["open_jobs"] = select(func.count()).where(ServiceJob.status.in_(("Pending", "In Process")))
    got = _counts(db, wanted)
    return {"fee_reminders": (got["fee_reminders"] or 0) if "fee_reminders" in got else None, "open_jobs": got.get("open_jobs")}


@router.get("/meta/notifications")
def notifications(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    wanted = {}
    if user.can("fees.view"):
        wanted["overdue_fees"] = fee_state_count_stmt(("Overdue",))
    if user.can("service_jobs.view"):
        wanted["urgent_jobs"] = select(func.count()).where(ServiceJob.status.in_(("Pending", "In Process")), ServiceJob.due_date < today())
    if user.can("service_bill.create"):
        wanted["unpaid_bills"] = select(func.count()).where(ServiceBill.status == "Unpaid")
    got = _counts(db, wanted)
    return {"overdue_fees": (got["overdue_fees"] or 0) if "overdue_fees" in got else None,
            "urgent_jobs": (got["urgent_jobs"] or 0) if "urgent_jobs" in got else None,
            "unpaid_bills": got.get("unpaid_bills"),
            "recent_activity": recent_audit(db, 3) if user.can("audit.view") else []}
