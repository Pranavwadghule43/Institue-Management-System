"""Student fee collection, immutable receipts, reversal (Admin-only) and reminders."""
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, load_only

from ..common import (
    PAY_LABEL, PAY_MODES, ZERO, In, OptStr, OptText, Paging, PayMode, PositiveMoney, Reason, add_months_clamped, amount_in_words, audit, bounds,
    institute, like, money, next_code, now, one_trip, paginate, paging, today, user_names, user_ref,
)
from ..db import get_db
from ..errors import bad, conflict, not_found
from ..ledger import fee_cols, fee_summary, reallocate
from ..models import FeeReceipt, FeeReminderEvent, Student, StudentInstallment, StudentPayment as P
from ..security import CurrentUser, require, require_admin, require_any
from .academics import fmt_time

router = APIRouter(tags=["student finance"])


def lock_student(db: Session, code: str) -> Student:
    """Row lock serialises every money change for one student (payments, reversals)."""
    s = db.scalars(select(Student).where(Student.student_code == code, Student.deleted_at.is_(None)).with_for_update()).first()
    if s is None:
        raise not_found("student")
    return s


def paid_total(db: Session, student_id: int) -> Decimal:
    return db.scalar(select(func.coalesce(func.sum(StudentInstallment.paid_amount), 0)).where(StudentInstallment.student_id == student_id)) or ZERO


def record_payment(db: Session, s: Student, amount: Decimal, mode: str, reference: str | None, remarks: str | None,
                   user: CurrentUser, idempotency_key: str | None = None) -> tuple[P, FeeReceipt]:
    """Payment + FIFO allocation + immutable receipt + audit, in the caller's transaction (student row must be locked)."""
    previous = paid_total(db, s.id)
    balance = s.net_fee - previous
    if amount <= 0 or amount > balance:
        raise bad("AMOUNT_EXCEEDS_BALANCE", f"Amount can't exceed the balance of {money(balance)}.", "amount")
    if mode == "Bank" and not reference:
        raise bad("REFERENCE_REQUIRED", "Transaction / UTR reference is required for bank transfers.", "reference")
    p = P(student_id=s.id, amount=amount, payment_mode=mode, payment_reference=reference, remarks=remarks, status="Valid",
          received_at=now(), collected_by=user.id, idempotency_key=idempotency_key)
    db.add(p)
    db.flush()
    reallocate(db, s.id)
    r = _issue_receipt(db, s, p, user, previous)
    audit(db, user.id, "PAYMENT_CREATED", "Payment", r.receipt_code, f"Collected {money(amount)} from {s.full_name} ({mode})",
          after={"amount": money(amount), "mode": mode, "student": s.student_code})
    return p, r


def _issue_receipt(db: Session, s: Student, p: P, user: CurrentUser, previous: Decimal) -> FeeReceipt:
    code = next_code(db, "RECEIPT")
    inst = institute(db)
    summary = fee_summary(db, s, today())
    total = previous + p.amount
    balance = s.net_fee - total
    next_date = "NIL" if balance <= 0 else summary["next_due"]["due_date"].isoformat() if summary["next_due"] else "Schedule needed"
    slot = s.time_slot
    months = int(s.course.duration) if (s.course.duration or "").isdigit() else None
    snapshot = {
        "receipt_no": code, "issued_at": p.received_at.isoformat(),
        "student": {"code": s.student_code, "name": s.full_name, "guardian": s.guardian_name, "mobile": s.mobile},
        "course": {"code": s.course.code, "name": s.course.name}, "course_subtype": ", ".join(st.name for st in s.subtypes) or None,
        # printed on the paper template: joining date, the 8 installment boxes, course expiry (admission + course duration)
        "joining_date": s.admission_date.isoformat(),
        "course_expiry_date": add_months_clamped(s.admission_date, months).isoformat() if months else None,
        "installments": [{"no": x["no"], "due_date": x["due_date"].isoformat(), "amount": x["amount"]} for x in summary["schedule"] if x["no"] > 0],
        "total_course_fee": money(s.net_fee),
        "time_slot": {"name": slot.name, "timing": f"{fmt_time(slot.start_time)} – {fmt_time(slot.end_time)}", "days": slot.days_of_week},
        "payment": {"amount": money(p.amount), "mode": p.payment_mode, "mode_label": PAY_LABEL[p.payment_mode],
                    "reference": p.payment_reference, "remarks": p.remarks, "collected_by": user.full_name},
        "amount_in_words": amount_in_words(p.amount), "net_fee": money(s.net_fee), "previous_paid": money(previous),
        "total_paid": money(total), "balance": money(balance), "next_payment_date": next_date,
        "institute": {"name": inst.name, "tagline": inst.tagline, "address": inst.address, "phone": inst.phone, "email": inst.email,
                      "receipt_heading": inst.receipt_heading or "Fee Receipt", "receipt_footer": inst.receipt_footer},
    }
    r = FeeReceipt(receipt_code=code, payment_id=p.id, student_id=s.id, snapshot=snapshot, next_payment_date_snapshot=next_date,
                   issued_at=p.received_at, issued_by=user.id)
    db.add(r)
    db.flush()
    return r


def payment_out(p: P, receipt_code: str | None, student: Student, names: dict) -> dict:
    return {"id": p.id, "receipt_no": receipt_code, "student": {"code": student.student_code, "name": student.full_name},
            "amount": money(p.amount), "mode": p.payment_mode, "mode_label": PAY_LABEL[p.payment_mode], "reference": p.payment_reference,
            "remarks": p.remarks, "status": p.status, "received_at": p.received_at, "collected_by": user_ref(names, p.collected_by),
            "reversed_by": user_ref(names, p.reversed_by), "reversed_at": p.reversed_at, "reversal_reason": p.reversal_reason}


def _receipt_code(db: Session, payment_id: int) -> str | None:
    return db.scalar(select(FeeReceipt.receipt_code).where(FeeReceipt.payment_id == payment_id))


# ----------------------------------------------------------------- fee summary / collection


@router.get("/fees/students/{code}/summary")
def student_fee_summary(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require_any("fees.view", "fees.collect"))):
    # QA-12: the Fee Collection screen needs this summary, so "Collect fees" alone must be able to read it
    s = db.scalars(select(Student).where(Student.student_code == code, Student.deleted_at.is_(None))).first()
    if s is None:
        raise not_found("student")
    return {"student": {"code": s.student_code, "name": s.full_name, "mobile": s.mobile, "whatsapp_number": s.whatsapp_number or s.mobile, "status": s.status,
                        "course": {"code": s.course.code, "name": s.course.name}, "time_slot": s.time_slot.name}} | fee_summary(db, s, today())


class PaymentIn(In):
    amount: PositiveMoney
    payment_mode: PayMode
    reference: OptStr(150) = None
    remarks: OptText = None


@router.post("/fees/students/{code}/payments", status_code=201)
def collect_fee(code: str, body: PaymentIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=120),
                db: Session = Depends(get_db), user: CurrentUser = Depends(require("fees.collect"))):
    s = lock_student(db, code)
    if idempotency_key:
        prior = db.scalars(select(P).where(P.idempotency_key == idempotency_key)).first()
        if prior is not None:
            if prior.student_id != s.id or prior.amount != body.amount:
                raise conflict("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different payment.")
            receipt = db.scalar(select(FeeReceipt).where(FeeReceipt.payment_id == prior.id))
            return {"payment": payment_out(prior, receipt.receipt_code if receipt else None, s, user_names(db, [prior.collected_by])),
                    "receipt": receipt_out(receipt, prior, s) if receipt else None, "replayed": True}
    p, r = record_payment(db, s, body.amount, body.payment_mode, body.reference, body.remarks, user, idempotency_key)
    db.commit()
    return {"payment": payment_out(p, r.receipt_code, s, {user.id: user.full_name}), "receipt": receipt_out(r, p, s), "replayed": False}


def _payments_query(q, mode, status, student_code, date_from, date_to):
    stmt = select(P, Student, FeeReceipt.receipt_code).join(Student, Student.id == P.student_id).outerjoin(FeeReceipt, FeeReceipt.payment_id == P.id)
    if q:
        stmt = stmt.where(or_(FeeReceipt.receipt_code.ilike(like(q)), Student.full_name.ilike(like(q)), Student.student_code.ilike(like(q))))
    if mode:
        stmt = stmt.where(P.payment_mode == mode)
    if status:
        stmt = stmt.where(P.status == status)
    if student_code:
        stmt = stmt.where(Student.student_code == student_code)
    if date_from or date_to:
        start, end = bounds(date_from or date(2000, 1, 1), date_to or today())
        stmt = stmt.where(P.received_at >= start, P.received_at < end)
    return stmt


@router.get("/fees/payments")
def list_payments(q: str | None = None, mode: PayMode | None = None, status: Literal["Valid", "Reversed"] | None = None,
                  student_code: str | None = None, date_from: date | None = None, date_to: date | None = None,
                  p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require_any("fees.view", "receipts.view_print"))):
    stmt = _payments_query(q, mode, status, student_code, date_from, date_to)
    sq = stmt.where(P.status == "Valid").with_only_columns(P.payment_mode, func.sum(P.amount), func.count()).group_by(P.payment_mode)
    by_mode = {m: (ZERO, 0) for m in PAY_MODES} | {m: (a, c) for m, a, c in db.execute(sq)}
    rows = db.execute(stmt.order_by(P.received_at.desc(), P.id.desc()).limit(p.page_size).offset((p.page - 1) * p.page_size)).all()
    names = user_names(db, [x.collected_by for x, *_ in rows] + [x.reversed_by for x, *_ in rows])
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    return {"items": [payment_out(x, rc, s, names) for x, s, rc in rows], "page": p.page, "page_size": p.page_size, "total": total,
            "pages": -(-total // p.page_size),
            "totals": {"collected": money(sum((a for a, _ in by_mode.values()), ZERO)), "receipts": sum(c for _, c in by_mode.values()),
                       "by_mode": [{"mode": m, "label": PAY_LABEL[m], "amount": money(a), "count": c} for m, (a, c) in by_mode.items()]}}


@router.get("/fees/payments/{payment_id}")
def get_payment(payment_id: int, db: Session = Depends(get_db), _: CurrentUser = Depends(require("fees.view"))):
    x = db.get(P, payment_id)
    if x is None:
        raise not_found("payment")
    return payment_out(x, _receipt_code(db, x.id), db.get(Student, x.student_id), user_names(db, [x.collected_by, x.reversed_by]))


class ReverseIn(In):
    reason: Reason


@router.post("/fees/payments/{payment_id}/reverse")
def reverse_payment(payment_id: int, body: ReverseIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_admin)):
    x = db.get(P, payment_id)
    if x is None:
        raise not_found("payment")
    s = db.scalars(select(Student).where(Student.id == x.student_id).with_for_update()).one()
    db.refresh(x, with_for_update=True)
    if x.status != "Valid":
        raise conflict("PAYMENT_ALREADY_REVERSED", "This payment is already reversed.")
    x.status, x.reversed_by, x.reversed_at, x.reversal_reason = "Reversed", user.id, now(), body.reason
    reallocate(db, s.id)
    code = _receipt_code(db, x.id)
    audit(db, user.id, "PAYMENT_REVERSED", "Payment", code, f"Payment {money(x.amount)} from {s.full_name} reversed",
          before={"status": "Valid", "amount": money(x.amount)}, after={"status": "Reversed", "amount": money(x.amount)}, reason=body.reason)
    db.commit()
    return payment_out(x, code, s, user_names(db, [x.collected_by, x.reversed_by]))


# ----------------------------------------------------------------- receipts


def send_to(s: Student | None) -> dict | None:
    """19 Nov: who a receipt is sent to on WhatsApp - the student's registered WhatsApp number now (same rule as the fee
    reminder), not the mobile frozen in the receipt snapshot."""
    return {"name": s.full_name, "whatsapp_number": s.whatsapp_number or s.mobile} if s else None


def receipt_out(r: FeeReceipt, p: P, s: Student | None = None) -> dict:
    """The issued snapshot is returned as-is; only the reversal status (and the WhatsApp number to send to) is live."""
    return {"receipt_no": r.receipt_code, "payment_id": p.id, "issued_at": r.issued_at, "status": p.status, "reversed_at": p.reversed_at,
            "reversal_reason": p.reversal_reason, "next_payment_date": r.next_payment_date_snapshot, "snapshot": r.snapshot, "send_to": send_to(s)}


def _receipt(db: Session, code: str) -> tuple[FeeReceipt, P]:
    row = db.execute(select(FeeReceipt, P).join(P, P.id == FeeReceipt.payment_id).where(FeeReceipt.receipt_code == code)).first()
    if row is None:
        raise not_found("receipt")
    return row


@router.get("/receipts")
def list_receipts(q: str | None = None, mode: PayMode | None = None, include_reversed: bool = False, date_from: date | None = None,
                  date_to: date | None = None, p: Paging = Depends(paging), db: Session = Depends(get_db),
                  _: CurrentUser = Depends(require("receipts.view_print"))):
    stmt = _payments_query(q, mode, None if include_reversed else "Valid", None, date_from, date_to).where(FeeReceipt.id.is_not(None))
    stmt = stmt.order_by(P.received_at.desc(), P.id.desc())
    return paginate(db, stmt, p, lambda row: {"receipt_no": row[2], "issued_at": row[0].received_at, "student": {"code": row[1].student_code, "name": row[1].full_name},
                                              "amount": money(row[0].amount), "mode": row[0].payment_mode, "status": row[0].status}, scalars=False)


@router.get("/receipts/{code}")
@router.get("/receipts/{code}/print-data")
def get_receipt(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("receipts.view_print"))):
    row = db.execute(select(FeeReceipt, P, Student).join(P, P.id == FeeReceipt.payment_id).join(Student, Student.id == P.student_id)
                     .options(load_only(Student.full_name, Student.whatsapp_number, Student.mobile))
                     .where(FeeReceipt.receipt_code == code)).one_or_none()
    if row is None:
        raise not_found("receipt")
    return receipt_out(*row)


class ShareIn(In):
    event_type: Literal["WHATSAPP_OPENED"] = "WHATSAPP_OPENED"


@router.post("/receipts/{code}/share-events", status_code=204)
def receipt_shared(code: str, body: ShareIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("receipts.view_print"))):
    r, _ = _receipt(db, code)
    # Opening wa.me is recorded as "opened", never as sent/delivered.
    audit(db, user.id, "RECEIPT_SHARED", "Payment", r.receipt_code, f"Receipt {r.receipt_code} opened in WhatsApp ({body.event_type})")
    db.commit()


# ----------------------------------------------------------------- reminders

TABS = {"today": "Due Today", "tomorrow": "Due Tomorrow", "overdue": "Overdue"}


@router.get("/fees/reminders")
def reminders(tab: Literal["today", "tomorrow", "overdue", "pending", "fully_paid"] = "overdue", q: str | None = None,
              course_id: int | None = None, p: Paging = Depends(paging), db: Session = Depends(get_db),
              _: CurrentUser = Depends(require("reminders.view"))):
    t = today()
    f = fee_cols(t)
    last = select(FeeReminderEvent.student_id.label("sid"), func.max(FeeReminderEvent.opened_at).label("at")).group_by(FeeReminderEvent.student_id).subquery()
    base = f.join(select(Student, f.paid, f.balance, f.next_due, f.next_remaining, f.state, last.c.at).outerjoin(last, last.c.sid == Student.id))
    base = base.where(Student.deleted_at.is_(None))
    if q:
        base = base.where(or_(Student.full_name.ilike(like(q)), Student.student_code.ilike(like(q)), Student.mobile.like(like(q.replace(" ", "")))))
    if course_id:
        base = base.where(Student.course_id == course_id)
    active = base.where(Student.status == "Active")
    count_stmts = {k: select(func.count()).select_from(active.where(f.state == v).subquery()) for k, v in TABS.items()}
    count_stmts["pending"] = select(func.count()).select_from(active.where(f.state != "Fully Paid").subquery())
    count_stmts["fully_paid"] = select(func.count()).select_from(base.where(f.state == "Fully Paid").subquery())
    if tab in TABS:
        stmt = active.where(f.state == TABS[tab]).order_by(f.next_due, Student.id)
    elif tab == "pending":
        stmt = active.where(f.state != "Fully Paid").order_by(f.balance.desc(), Student.id)
    else:  # mirrors the UI: fully paid across all statuses
        stmt = base.where(f.state == "Fully Paid").order_by(Student.full_name)
    stmt = stmt.options(joinedload(Student.course))
    # All tab counts + the page's "total due" in one round trip (performance); every statement is unchanged.
    due_stmt = select(func.coalesce(func.sum(stmt.subquery().c.remaining), 0)) if tab != "fully_paid" else None
    got = one_trip(db, *count_stmts.values(), *([due_stmt] if due_stmt is not None else []))
    counts = dict(zip(count_stmts, got))
    page = paginate(db, stmt, p, lambda r: {
        "student": {"code": r[0].student_code, "name": r[0].full_name, "mobile": r[0].mobile, "whatsapp_number": r[0].whatsapp_number},
        "course": {"id": r[0].course.id, "code": r[0].course.code}, "next_due_date": r[3], "installment_due": money(r[4] or 0),
        "balance": money(r[2]), "total_paid": money(r[1]), "fee_state": r[5], "overdue_days": (t - r[3]).days if r[3] and r[3] < t else 0,
        "last_reminded_at": r[6]}, scalars=False, counts=counts)
    page["total_due"] = money(got[len(count_stmts)] if due_stmt is not None else 0)
    return page


class ReminderIn(In):
    note: OptText = None


@router.post("/fees/reminders/{code}/opened-whatsapp", status_code=201)
def reminder_opened(code: str, body: ReminderIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("reminders.view"))):
    s = db.scalars(select(Student).where(Student.student_code == code, Student.deleted_at.is_(None))).first()
    if s is None:
        raise not_found("student")
    e = FeeReminderEvent(student_id=s.id, opened_by=user.id, channel="WhatsApp", note=body.note)
    db.add(e)
    db.commit()
    # "opened" only: wa.me cannot confirm the message was sent or delivered.
    return {"student_code": s.student_code, "opened_at": e.opened_at, "channel": e.channel}
