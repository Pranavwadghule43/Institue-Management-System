"""Single source of truth for money: fee state, installment allocation, and income/expense totals.

Income ledger = student_payments (status Valid, by received_at) + service_bills (status Paid, by paid_at).
Expenses = expenses (not soft-deleted, by expense_date). Receipts are never summed, so nothing is double-counted.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import and_, case, delete, func, select
from sqlalchemy.orm import Session

from .common import ZERO, bounds, local_date, money, one_trip, q2
from .errors import AppError
from .models import Expense, ServiceBill, Student, StudentInstallment as I, StudentPayment as P, StudentPaymentAllocation as A

# DB check `installment_no > 0` vs the UI's row 0 "Admission": rows are stored as display_no + 1.
# ponytail: if the DB lead relaxes the check to >= 0, set this to 0 (existing rows then need a renumber).
INSTALLMENT_NO_OFFSET = 1

FEE_STATES = ("Fully Paid", "Overdue", "Due Today", "Due Tomorrow", "On Track")


def pct(part, whole) -> int:
    """Mirror of pct() in src/lib/format.ts (0 when whole <= 0, half-up)."""
    return 0 if not whole or whole <= 0 else int((Decimal(part) * 100 / Decimal(whole)).quantize(Decimal(1), ROUND_HALF_UP))


def row_state(amount: Decimal, paid: Decimal, due: date, t: date) -> str:
    """Mirror of scheduleFor() in src/data/store.ts."""
    if paid >= amount:
        return "Paid"
    if due == t:
        return "Due Today"
    if due < t:
        return "Overdue"
    return "Partial" if paid > 0 else "Upcoming"


@dataclass
class FeeCols:
    """SQL columns for per-student fee state; join with .join(stmt)."""
    paid: object
    balance: object
    next_due: object
    next_remaining: object
    state: object
    _paid_sq: object
    _next_sq: object

    def join(self, stmt):
        return stmt.outerjoin(self._paid_sq, self._paid_sq.c.sid == Student.id).outerjoin(self._next_sq, self._next_sq.c.sid == Student.id)


def fee_cols(t: date) -> FeeCols:
    paid_sq = select(I.student_id.label("sid"), func.sum(I.paid_amount).label("paid")).group_by(I.student_id).subquery()
    first = select(I.student_id.label("sid"), func.min(I.installment_no).label("no")).where(I.paid_amount < I.amount).group_by(I.student_id).subquery()
    next_sq = (select(I.student_id.label("sid"), I.due_date.label("due"), (I.amount - I.paid_amount).label("remaining"))
               .join(first, and_(first.c.sid == I.student_id, first.c.no == I.installment_no)).subquery())
    paid = func.coalesce(paid_sq.c.paid, 0)
    state = case((next_sq.c.due.is_(None), "Fully Paid"), (next_sq.c.due < t, "Overdue"), (next_sq.c.due == t, "Due Today"),
                 (next_sq.c.due == t + timedelta(days=1), "Due Tomorrow"), else_="On Track")
    return FeeCols(paid, Student.net_fee - paid, next_sq.c.due, next_sq.c.remaining, state, paid_sq, next_sq)


def fee_summary(db: Session, s: Student, t: date) -> dict:
    rows = db.scalars(select(I).where(I.student_id == s.id).order_by(I.installment_no)).all()
    schedule = []
    for r in rows:
        no = r.installment_no - INSTALLMENT_NO_OFFSET
        schedule.append({"no": no, "label": "Admission" if no == 0 else f"Installment {no}", "due_date": r.due_date,
                         "amount": money(r.amount), "paid": money(r.paid_amount), "state": row_state(r.amount, r.paid_amount, r.due_date, t)})
    paid = sum((r.paid_amount for r in rows), ZERO)
    nxt = next(((r, x) for r, x in zip(rows, schedule) if x["state"] != "Paid"), None)
    if nxt is None:
        state = "Fully Paid"
    else:
        due = nxt[0].due_date
        state = "Overdue" if due < t else "Due Today" if due == t else "Due Tomorrow" if due == t + timedelta(days=1) else "On Track"
    return {
        "agreed_fee": money(s.agreed_fee), "discount": money(s.discount), "net_fee": money(s.net_fee),
        "total_paid": money(paid), "balance": money(max(ZERO, s.net_fee - paid)),
        "paid_pct": pct(paid, s.net_fee),
        "fee_state": state,
        "next_due": None if nxt is None else {"due_date": nxt[0].due_date, "amount": money(nxt[0].amount - nxt[0].paid_amount), "label": nxt[1]["label"]},
        "overdue_days": (t - nxt[0].due_date).days if nxt and nxt[0].due_date < t else 0,
        "schedule": schedule,
    }


def reallocate(db: Session, student_id: int) -> None:
    """Rebuild allocations FIFO from valid payments (oldest first), exactly like the UI's pooled schedule.

    Caller must hold the student row lock. Running it after every payment and reversal keeps
    student_installments.paid_amount == sum of valid payments, with no partial state to unwind.
    """
    insts = db.scalars(select(I).where(I.student_id == student_id).order_by(I.installment_no)).all()
    pays = db.scalars(select(P).where(P.student_id == student_id, P.status == "Valid").order_by(P.received_at, P.id)).all()
    db.execute(delete(A).where(A.payment_id.in_(select(P.id).where(P.student_id == student_id))))
    for i in insts:
        i.paid_amount = ZERO
    idx = 0
    for p in pays:
        left = p.amount
        while left > 0 and idx < len(insts):
            i = insts[idx]
            take = min(i.amount - i.paid_amount, left)
            if take > 0:
                i.paid_amount += take
                left -= take
                db.add(A(payment_id=p.id, installment_id=i.id, allocated_amount=take))
            if i.paid_amount >= i.amount:
                idx += 1
        if left > 0:
            raise AppError(400, "AMOUNT_EXCEEDS_BALANCE", "Payments exceed the student's net fee.")
    db.flush()


# ----------------------------------------------------------------- income / expense totals


def totals_stmts(d_from: date, d_to: date, staff_id: int | None = None) -> tuple:
    """The three sums behind totals(): fees, services, expenses (so callers can batch them with other counts)."""
    start, end = bounds(d_from, d_to)
    fq = select(func.coalesce(func.sum(P.amount), 0)).where(P.status == "Valid", P.received_at >= start, P.received_at < end)
    sq = select(func.coalesce(func.sum(ServiceBill.grand_total), 0)).where(ServiceBill.status == "Paid", ServiceBill.paid_at >= start, ServiceBill.paid_at < end)
    eq = select(func.coalesce(func.sum(Expense.amount), 0)).where(Expense.deleted_at.is_(None), Expense.expense_date.between(d_from, d_to))
    if staff_id is not None:
        fq, sq, eq = fq.where(P.collected_by == staff_id), sq.where(ServiceBill.paid_by == staff_id), eq.where(Expense.created_by == staff_id)
    return fq, sq, eq


def totals_from(fees, services, expenses) -> dict:
    fees, services, expenses = q2(fees), q2(services), q2(expenses)
    return {"fees": fees, "services": services, "expenses": expenses, "income": fees + services, "net": fees + services - expenses}


def totals(db: Session, d_from: date, d_to: date, staff_id: int | None = None) -> dict:
    return totals_from(*one_trip(db, *totals_stmts(d_from, d_to, staff_id)))  # same three sums, one round trip


def month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def series(db: Session, d_from: date, d_to: date, by: str = "day") -> list[dict]:
    """Daily or monthly income/expense buckets in institute-local dates, every bucket present.

    ponytail: buckets in Python to stay portable (AT TIME ZONE vs CONVERT_TZ); fine for one institute's volume.
    """
    start, end = bounds(d_from, d_to)
    key = (lambda d: d.isoformat()) if by == "day" else month_key
    acc: dict[str, dict] = defaultdict(lambda: {"fees": ZERO, "services": ZERO, "expenses": ZERO, "receipts": 0, "bills": 0})
    for at, amt in db.execute(select(P.received_at, P.amount).where(P.status == "Valid", P.received_at >= start, P.received_at < end)):
        b = acc[key(local_date(at))]
        b["fees"] += amt
        b["receipts"] += 1
    for at, amt in db.execute(select(ServiceBill.paid_at, ServiceBill.grand_total).where(ServiceBill.status == "Paid", ServiceBill.paid_at >= start, ServiceBill.paid_at < end)):
        b = acc[key(local_date(at))]
        b["services"] += amt
        b["bills"] += 1
    for d, amt in db.execute(select(Expense.expense_date, Expense.amount).where(Expense.deleted_at.is_(None), Expense.expense_date.between(d_from, d_to))):
        acc[key(d)]["expenses"] += amt
    keys, d = [], d_from
    while d <= d_to:
        k = key(d)
        if not keys or keys[-1] != k:
            keys.append(k)
        d += timedelta(days=1)
    out = []
    for k in keys:
        b = acc[k]
        out.append({"key": k, "fees": b["fees"], "services": b["services"], "expenses": b["expenses"], "receipts": b["receipts"],
                    "bills": b["bills"], "income": b["fees"] + b["services"], "net": b["fees"] + b["services"] - b["expenses"]})
    return out


def money_dict(d: dict) -> dict:
    return {k: money(v) if isinstance(v, Decimal) else v for k, v in d.items()}
