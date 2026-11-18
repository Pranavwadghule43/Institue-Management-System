"""Expenses (soft delete, audited) and expense categories."""
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..common import (
    In, OptText, Paging, PayMode, PositiveMoney, Str, apply_changes, audit, like, money, next_code, now, one_trip, paginate, paging, today,
    user_names, user_ref,
)
from ..db import get_db
from ..errors import bad, conflict, not_found
from ..models import Expense, ExpenseCategory
from ..security import CurrentUser, get_current_user, require

router = APIRouter(tags=["expenses"])


class ExpenseIn(In):
    amount: PositiveMoney
    expense_date: date | None = None  # default: today
    category_id: int
    payment_mode: PayMode
    description: Str(1000)


class ExpensePatch(In):
    amount: PositiveMoney | None = None
    expense_date: date | None = None
    category_id: int | None = None
    payment_mode: PayMode | None = None
    description: Str(1000) | None = None


class DeleteIn(In):
    reason: OptText = None


def _category(db: Session, cid: int, active: bool = True) -> ExpenseCategory:
    c = db.get(ExpenseCategory, cid)
    if c is None or (active and not c.is_active):
        raise bad("INVALID_CATEGORY", "Choose an active expense category.", "category_id")
    return c


def _get(db: Session, code: str) -> Expense:
    e = db.scalars(select(Expense).where(Expense.expense_code == code, Expense.deleted_at.is_(None))).first()
    if e is None:
        raise not_found("expense")
    return e


def expense_out(e: Expense, names: dict) -> dict:
    return {"code": e.expense_code, "expense_date": e.expense_date, "amount": money(e.amount), "category": {"id": e.category.id, "name": e.category.name},
            "payment_mode": e.payment_mode, "description": e.description, "added_by": user_ref(names, e.created_by),
            "has_attachment": e.attachment_file_id is not None, "created_at": e.created_at, "updated_at": e.updated_at}


def _check_date(d: date):
    if d > today():
        raise bad("FUTURE_DATE", "Expense date can't be in the future.", "expense_date")


def period_range(period: str | None, date_from: date | None, date_to: date | None) -> tuple[date | None, date | None]:
    t = today()
    if period == "today":
        return t, t
    if period == "month":
        return t.replace(day=1), t
    if period == "90d":
        return t - timedelta(days=89), t
    return date_from, date_to


@router.get("/expenses")
def list_expenses(q: str | None = None, period: Literal["today", "month", "90d"] | None = None, date_from: date | None = None,
                  date_to: date | None = None, category_id: int | None = None, payment_mode: PayMode | None = None,
                  p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require("expenses.view"))):
    stmt = select(Expense).join(ExpenseCategory).where(Expense.deleted_at.is_(None))
    d_from, d_to = period_range(period, date_from, date_to)
    if d_from:
        stmt = stmt.where(Expense.expense_date >= d_from)
    if d_to:
        stmt = stmt.where(Expense.expense_date <= d_to)
    if q:
        stmt = stmt.where(or_(Expense.description.ilike(like(q)), ExpenseCategory.name.ilike(like(q)), Expense.expense_code.ilike(like(q))))
    if category_id:
        stmt = stmt.where(Expense.category_id == category_id)
    if payment_mode:
        stmt = stmt.where(Expense.payment_mode == payment_mode)
    total = db.scalar(select(func.coalesce(func.sum(stmt.subquery().c.amount), 0)))
    names = user_names(db, db.scalars(stmt.with_only_columns(Expense.created_by).distinct()))
    stmt = stmt.options(joinedload(Expense.category)).order_by(Expense.expense_date.desc(), Expense.created_at.desc())
    return paginate(db, stmt, p, lambda e: expense_out(e, names), total_amount=money(total))


@router.get("/expenses/summary")
def expense_summary(db: Session = Depends(get_db), _: CurrentUser = Depends(require("expenses.view"))):
    t = today()
    first = t.replace(day=1)
    prev_first = (first - timedelta(days=1)).replace(day=1)
    live = Expense.deleted_at.is_(None)

    periods = {"today": (t, t), "this_month": (first, t), "last_month": (prev_first, first - timedelta(days=1))}
    # Sum and count for all three periods in one round trip (performance); same filters as before.
    got = one_trip(db, *(s for a, b in periods.values() for s in (
        select(func.coalesce(func.sum(Expense.amount), 0)).where(live, Expense.expense_date.between(a, b)),
        select(func.count()).where(live, Expense.expense_date.between(a, b)))))
    by_cat = db.execute(select(ExpenseCategory.name, func.sum(Expense.amount)).join(ExpenseCategory).where(live, Expense.expense_date.between(first, t))
                        .group_by(ExpenseCategory.name).order_by(func.sum(Expense.amount).desc())).all()
    out = {k: {"amount": money(got[2 * i]), "count": got[2 * i + 1]} for i, k in enumerate(periods)}
    return out | {"this_month_by_category": [{"category": c, "amount": money(a)} for c, a in by_cat]}


@router.post("/expenses", status_code=201)
def create_expense(body: ExpenseIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("expenses.create"))):
    d = body.expense_date or today()
    _check_date(d)
    cat = _category(db, body.category_id)
    e = Expense(expense_code=next_code(db, "EXPENSE"), expense_date=d, category_id=cat.id, amount=body.amount, payment_mode=body.payment_mode,
                description=body.description, created_by=user.id)
    db.add(e)
    db.flush()
    audit(db, user.id, "EXPENSE_CREATED", "Expense", e.expense_code, f"{cat.name} - {money(e.amount)}", after={"amount": money(e.amount), "category": cat.name})
    db.commit()
    db.refresh(e)
    return expense_out(e, {user.id: user.full_name})


@router.get("/expenses/{code}")
def get_expense(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("expenses.view"))):
    e = _get(db, code)
    return expense_out(e, user_names(db, [e.created_by]))


@router.patch("/expenses/{code}")
def update_expense(code: str, body: ExpensePatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("expenses.edit_delete"))):
    e = _get(db, code)
    data = body.model_dump(exclude_unset=True)
    for k in ("amount", "expense_date", "category_id", "payment_mode", "description"):
        if k in data and data[k] is None:
            raise bad("FIELD_REQUIRED", f"{k.replace('_', ' ').capitalize()} is required.", k)
    if "expense_date" in data:
        _check_date(data["expense_date"])
    if "category_id" in data and data["category_id"] != e.category_id:
        _category(db, data["category_id"])
    before, after = apply_changes(e, data)
    if after:
        audit(db, user.id, "EXPENSE_UPDATED", "Expense", e.expense_code, f"Expense {e.expense_code} edited", before, after)
    db.commit()
    db.refresh(e)
    return expense_out(e, user_names(db, [e.created_by]))


@router.delete("/expenses/{code}", status_code=204)
def delete_expense(code: str, body: DeleteIn | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(require("expenses.edit_delete"))):
    """Soft delete: drops out of Daily Cash / P&L, stays in Deleted History."""
    e = _get(db, code)
    e.deleted_at = now()
    audit(db, user.id, "EXPENSE_DELETED", "Expense", e.expense_code, f"{e.category.name} expense deleted",
          {"amount": money(e.amount), "category": e.category.name, "date": e.expense_date.isoformat()}, {"status": "Deleted"}, body.reason if body else None)
    db.commit()


# ----------------------------------------------------------------- categories


class CategoryIn(In):
    name: Str(160)


class CategoryPatch(In):
    name: Str(160) | None = None
    is_active: bool | None = None


def _unique(db: Session, name: str, exclude: int | None = None):
    stmt = select(ExpenseCategory.id).where(func.lower(ExpenseCategory.name) == name.lower())
    if exclude:
        stmt = stmt.where(ExpenseCategory.id != exclude)
    if db.scalar(stmt):
        raise conflict("CATEGORY_EXISTS", "A category with this name already exists.")


@router.get("/expense-categories")
def list_categories(active: bool | None = None, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    used = dict(db.execute(select(Expense.category_id, func.count()).where(Expense.deleted_at.is_(None)).group_by(Expense.category_id)).all())
    stmt = select(ExpenseCategory).order_by(ExpenseCategory.name)
    if active is not None:
        stmt = stmt.where(ExpenseCategory.is_active.is_(active))
    return [{"id": c.id, "name": c.name, "is_active": c.is_active, "expenses": used.get(c.id, 0)} for c in db.scalars(stmt)]


@router.post("/expense-categories", status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("settings.manage"))):
    _unique(db, body.name)
    c = ExpenseCategory(name=body.name, is_active=True)
    db.add(c)
    db.flush()
    audit(db, user.id, "EXPENSE_CATEGORY_CREATED", "Expense Category", str(c.id), f"Expense category {c.name} added")
    db.commit()
    return {"id": c.id, "name": c.name, "is_active": c.is_active, "expenses": 0}


@router.patch("/expense-categories/{cid}")
def update_category(cid: int, body: CategoryPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("settings.manage"))):
    c = db.get(ExpenseCategory, cid)
    if c is None:
        raise not_found("expense category")
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "name" in data:
        _unique(db, data["name"], c.id)
    before, after = apply_changes(c, data)
    if after:  # categories are deactivated, never removed, because expenses reference them
        audit(db, user.id, "EXPENSE_CATEGORY_UPDATED", "Expense Category", str(c.id), f"Expense category {c.name} updated", before, after)
    db.commit()
    return {"id": c.id, "name": c.name, "is_active": c.is_active}
