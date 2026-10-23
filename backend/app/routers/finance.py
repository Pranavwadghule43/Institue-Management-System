"""Daily Cash and Profit & Loss, both computed from the single ledger in app/ledger.py."""
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..common import PAY_LABEL, PAY_MODES, ZERO, bounds, money, today
from ..db import get_db
from ..errors import bad
from ..ledger import money_dict, series, totals
from ..models import Customer, Expense, ExpenseCategory, FeeReceipt, ServiceBill, ServicePayment, Student, StudentPayment as P
from ..security import CurrentUser, require

router = APIRouter(prefix="/finance", tags=["finance"])


@router.get("/daily-cash")
def daily_cash(date_: date | None = Query(None, alias="date"), db: Session = Depends(get_db), _: CurrentUser = Depends(require("reports.view"))):
    d = date_ or today()
    start, end = bounds(d, d)
    pays = db.execute(select(P, Student.full_name, FeeReceipt.receipt_code).join(Student, Student.id == P.student_id)
                      .outerjoin(FeeReceipt, FeeReceipt.payment_id == P.id).where(P.status == "Valid", P.received_at >= start, P.received_at < end)).all()
    bills = db.execute(select(ServiceBill, Customer.full_name, ServicePayment.payment_mode).join(Customer, Customer.id == ServiceBill.customer_id)
                       .join(ServicePayment, ServicePayment.bill_id == ServiceBill.id)
                       .where(ServiceBill.status == "Paid", ServiceBill.paid_at >= start, ServiceBill.paid_at < end)).all()
    exps = db.execute(select(Expense, ExpenseCategory.name).join(ExpenseCategory).where(Expense.deleted_at.is_(None), Expense.expense_date == d)).all()
    ledger = ([{"at": p.received_at, "kind": "Student fee", "ref": rc, "party": name, "mode": p.payment_mode, "amount": p.amount} for p, name, rc in pays]
              + [{"at": b.paid_at, "kind": "Service bill", "ref": b.bill_code, "party": name, "mode": mode, "amount": b.grand_total} for b, name, mode in bills]
              + [{"at": e.created_at, "kind": "Expense", "ref": e.expense_code, "party": f"{cat} - {e.description}", "mode": e.payment_mode, "amount": -e.amount} for e, cat in exps])
    ledger.sort(key=lambda x: x["at"], reverse=True)
    by_mode = []
    for m in PAY_MODES:
        i = sum((x["amount"] for x in ledger if x["mode"] == m and x["amount"] > 0), ZERO)
        o = -sum((x["amount"] for x in ledger if x["mode"] == m and x["amount"] < 0), ZERO)
        by_mode.append({"mode": m, "label": PAY_LABEL[m], "in": money(i), "out": money(o), "net": money(i - o)})
    t = totals(db, d, d)
    return {"date": d, "fees": money(t["fees"]), "services": money(t["services"]), "expenses": money(t["expenses"]), "net": money(t["net"]),
            "counts": {"receipts": len(pays), "paid_bills": len(bills), "expenses": len(exps)},
            "ledger": [x | {"amount": money(x["amount"])} for x in ledger], "by_mode": by_mode}


def pnl_range(period: str, date_from: date | None, date_to: date | None) -> tuple[date, date, str]:
    t = today()
    if period == "today":
        return t, t, "Today"
    if period == "week":
        return t - timedelta(days=t.weekday()), t, "This week"
    if period == "month":
        return t.replace(day=1), t, "This month (to date)"
    if period == "financial_year":
        fy = t.year if t.month >= 4 else t.year - 1
        return date(fy, 4, 1), t, f"FY {fy}-{str(fy + 1)[2:]} (to date)"
    if not date_from or not date_to or date_to < date_from:
        raise bad("INVALID_RANGE", "Choose a valid custom date range.", "date_from")
    return date_from, date_to, f"{date_from.isoformat()} to {date_to.isoformat()}"


@router.get("/pnl")
def profit_and_loss(period: Literal["today", "week", "month", "financial_year", "custom"] = "month", date_from: date | None = None,
                    date_to: date | None = None, db: Session = Depends(get_db), _: CurrentUser = Depends(require("reports.view"))):
    d_from, d_to, label = pnl_range(period, date_from, date_to)
    t = totals(db, d_from, d_to)
    by_cat = db.execute(select(ExpenseCategory.name, func.sum(Expense.amount)).join(ExpenseCategory)
                        .where(Expense.deleted_at.is_(None), Expense.expense_date.between(d_from, d_to))
                        .group_by(ExpenseCategory.name).order_by(func.sum(Expense.amount).desc())).all()
    end = today()
    trend_from = (end.replace(day=1) - timedelta(days=330)).replace(day=1)  # last 12 months, current month to date
    margin = int(t["net"] * 100 / t["income"]) if t["income"] else 0
    return {
        "period": period, "label": label, "date_from": d_from, "date_to": d_to,
        "student_fee_income": money(t["fees"]), "service_income": money(t["services"]), "total_income": money(t["income"]),
        "expenses": money(t["expenses"]), "net_profit": money(t["net"]), "margin_pct": margin,
        "expense_by_category": [{"category": c, "amount": money(a)} for c, a in by_cat],
        "monthly_trend": [money_dict(m) | {"partial": m["key"] == f"{end.year}-{end.month:02d}"} for m in series(db, trend_from, end, "month")],
        # Service cost rule is not decided (open item C-46): never invent cost/profit.
        "service_profit": {"revenue": money(t["services"]), "cost": None, "profit": None, "calculation_status": "pending_cost_rule"},
    }
