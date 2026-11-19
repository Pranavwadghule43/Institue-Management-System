"""Service bills: server-calculated lines, Admin-only rate override, full payment only, paid lock, audited cancel + replacement."""
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Header
from pydantic import Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..common import (
    PAY_LABEL, ZERO, In, Money, OptStr, Paging, PayMode, Reason, Str, amount_in_words, audit, bounds, institute, like, money, next_code,
    now, paginate, paging, today, user_names, user_ref,
)
from ..db import get_db
from ..errors import AppError, bad, conflict, not_found
from ..models import Customer, Service, ServiceBill, ServiceBillItem, ServiceJob, ServicePayment
from ..security import CurrentUser, require
from .jobs import get_job

router = APIRouter(prefix="/service-bills", tags=["service bills"])


class LineIn(In):
    service_id: int
    quantity: int = Field(ge=1, le=999)
    rate: Money | None = None  # omitted -> Service Master price; any other rate needs service_bill.rate_override


class BillIn(In):
    job_code: Str(40)
    items: list[LineIn] = Field(min_length=1, max_length=100)
    discount: Money = ZERO


class BillPatch(In):
    items: list[LineIn] = Field(min_length=1, max_length=100)
    discount: Money = ZERO


class PayIn(In):
    payment_mode: PayMode
    reference: OptStr(150) = None


class CancelIn(In):
    reason: Reason


def get_bill(db: Session, code: str, lock: bool = False, *, detail: bool = False) -> ServiceBill:
    stmt = select(ServiceBill).where(ServiceBill.bill_code == code)
    if detail:
        stmt = stmt.options(joinedload(ServiceBill.customer), joinedload(ServiceBill.job), joinedload(ServiceBill.items))
    b = db.scalars(stmt.with_for_update(of=ServiceBill) if lock else stmt).unique().first()
    if b is None:
        raise not_found("bill")
    return b


def build_lines(db: Session, items: list[LineIn], discount: Decimal, user: CurrentUser, existing: list[ServiceBillItem] = ()) -> tuple[list[ServiceBillItem], Decimal, Decimal, list[dict]]:
    """Server-side calculation. Same service at the same rate is combined (like the bill desk); unchanged existing lines keep their snapshot."""
    services = {s.id: s for s in db.scalars(select(Service).where(Service.id.in_({i.service_id for i in items})))}
    kept = {(x.service_id, x.rate): x for x in existing}
    merged: dict[tuple[int, Decimal], int] = {}
    for line in items:
        s = services.get(line.service_id)
        if s is None:
            raise bad("INVALID_SERVICE", "One of the services doesn't exist.", "items")
        rate = s.customer_price if line.rate is None else line.rate
        key = (s.id, rate)
        if key not in kept:
            if not s.is_active:
                raise bad("SERVICE_INACTIVE", f"{s.name} is no longer active.", "items")
            if rate != s.customer_price and not user.can("service_bill.rate_override"):
                raise AppError(403, "RATE_OVERRIDE_NOT_ALLOWED", "Only the Admin can change a service rate on a bill.")
        merged[key] = merged.get(key, 0) + line.quantity
        if merged[key] > 999:
            raise bad("QUANTITY_TOO_LARGE", "Quantity can't exceed 999 per line.", "items")
    lines, overrides = [], []
    for (sid, rate), qty in merged.items():
        s, old = services[sid], kept.get((sid, rate))
        master = old.master_rate_snapshot if old else s.customer_price
        by = old.overridden_by if old else (user.id if rate != master else None)
        if not old and by:
            overrides.append({"service": s.name, "master_rate": money(master), "rate": money(rate)})
        lines.append(ServiceBillItem(service_id=sid, service_name_snapshot=old.service_name_snapshot if old else s.name, quantity=qty,
                                     master_rate_snapshot=master, rate=rate, line_amount=rate * qty, overridden_by=by))
    subtotal = sum((x.line_amount for x in lines), ZERO)
    if discount > subtotal:
        raise bad("DISCOUNT_EXCEEDS_SUBTOTAL", "Discount can't be more than the subtotal.", "discount")
    return lines, subtotal, discount, overrides


def bill_out(db: Session, b: ServiceBill) -> dict:
    pay = db.scalars(select(ServicePayment).where(ServicePayment.bill_id == b.id)).first()
    names = user_names(db, [b.created_by, b.paid_by, b.cancelled_by] + [i.overridden_by for i in b.items])
    inst = institute(db)
    replaces = db.scalars(select(ServiceBill.bill_code).where(ServiceBill.job_id == b.job_id, ServiceBill.status == "Cancelled", ServiceBill.id != b.id)).all()
    return {
        "code": b.bill_code, "status": b.status,
        "job": {"code": b.job.job_code, "status": b.job.status, "application_name": b.job.application_name},
        "customer": {"code": b.customer.customer_code, "name": b.customer.full_name, "mobile": b.customer.mobile,
                     "whatsapp_number": b.customer.whatsapp_number or b.customer.mobile},
        "items": [{"id": i.id, "service_id": i.service_id, "name": i.service_name_snapshot, "quantity": i.quantity, "master_rate": money(i.master_rate_snapshot),
                   "rate": money(i.rate), "line_amount": money(i.line_amount), "overridden": i.rate != i.master_rate_snapshot,
                   "overridden_by": user_ref(names, i.overridden_by)} for i in b.items],
        "units": sum(i.quantity for i in b.items), "subtotal": money(b.subtotal), "discount": money(b.discount), "grand_total": money(b.grand_total),
        "amount_in_words": amount_in_words(b.grand_total),
        "created_by": user_ref(names, b.created_by), "created_at": b.created_at, "paid_by": user_ref(names, b.paid_by), "paid_at": b.paid_at,
        "payment": {"amount": money(pay.amount), "mode": pay.payment_mode, "mode_label": PAY_LABEL[pay.payment_mode], "reference": pay.reference} if pay else None,
        "cancelled_by": user_ref(names, b.cancelled_by), "cancelled_at": b.cancelled_at, "cancellation_reason": b.cancellation_reason,
        "replaces": replaces,
        "institute": {"name": inst.name, "tagline": inst.tagline, "address": inst.address, "phone": inst.phone,
                      "bill_footer": inst.service_bill_footer, "account_note": inst.service_bill_account_note},
    }


@router.get("")
def list_bills(q: str | None = None, status: Literal["Unpaid", "Paid", "Cancelled"] | None = None, date_from: date | None = None,
               date_to: date | None = None, p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require("service_bill.create"))):
    stmt = select(ServiceBill, ServiceJob.job_code, Customer.full_name, ServicePayment.payment_mode, func.count(ServiceBillItem.id)).join(
        ServiceJob, ServiceJob.id == ServiceBill.job_id).join(Customer, Customer.id == ServiceBill.customer_id).outerjoin(
        ServicePayment, ServicePayment.bill_id == ServiceBill.id).outerjoin(ServiceBillItem, ServiceBillItem.bill_id == ServiceBill.id).group_by(
        ServiceBill.id, ServiceJob.job_code, Customer.full_name, ServicePayment.payment_mode)
    if q:
        stmt = stmt.where(or_(ServiceBill.bill_code.ilike(like(q)), ServiceJob.job_code.ilike(like(q)), Customer.full_name.ilike(like(q))))
    if status:
        stmt = stmt.where(ServiceBill.status == status)
    if date_from or date_to:
        start, end = bounds(date_from or date(2000, 1, 1), date_to or today())
        stmt = stmt.where(ServiceBill.created_at >= start, ServiceBill.created_at < end)
    totals = {s: {"amount": money(a), "count": c} for s, a, c in db.execute(
        select(ServiceBill.status, func.coalesce(func.sum(ServiceBill.grand_total), 0), func.count()).group_by(ServiceBill.status))}
    totals = {s: totals.get(s, {"amount": money(0), "count": 0}) for s in ("Paid", "Unpaid", "Cancelled")}
    paid = totals["Paid"]
    totals["average_paid"] = money(Decimal(paid["amount"]) / paid["count"] if paid["count"] else 0)
    stmt = stmt.order_by(ServiceBill.created_at.desc(), ServiceBill.id.desc())
    return paginate(db, stmt, p, lambda r: {"code": r[0].bill_code, "job_code": r[1], "customer": r[2], "items": r[4], "created_at": r[0].created_at,
                                            "paid_at": r[0].paid_at, "mode": r[3], "grand_total": money(r[0].grand_total), "status": r[0].status},
                    scalars=False, totals=totals)


@router.post("", status_code=201)
def create_bill(body: BillIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_bill.create"))):
    job = get_job(db, body.job_code, lock=True)
    if job.status == "Cancelled":
        raise conflict("JOB_CANCELLED", "Cancelled jobs can't be billed.")
    if db.scalar(select(ServiceBill.id).where(ServiceBill.job_id == job.id, ServiceBill.status != "Cancelled")):
        raise conflict("BILL_ALREADY_EXISTS", "This service job already has a current bill.")
    lines, subtotal, discount, overrides = build_lines(db, body.items, body.discount, user)
    b = ServiceBill(bill_code=next_code(db, "BILL"), job_id=job.id, customer_id=job.customer_id, subtotal=subtotal, discount=discount,
                    grand_total=subtotal - discount, status="Unpaid", created_by=user.id)
    db.add(b)
    db.flush()
    for x in lines:
        x.bill_id = b.id
        db.add(x)
    replaces = db.scalars(select(ServiceBill.bill_code).where(ServiceBill.job_id == job.id, ServiceBill.status == "Cancelled")).all()
    audit(db, user.id, "BILL_CREATED", "Service Bill", b.bill_code,
          f"Bill {b.bill_code} created for {job.job_code} - {money(b.grand_total)}" + (f" (replaces {', '.join(replaces)})" if replaces else ""),
          after={"grand_total": money(b.grand_total), "items": len(lines)})
    if overrides:
        audit(db, user.id, "BILL_RATE_OVERRIDDEN", "Service Bill", b.bill_code, f"Rate override on {b.bill_code}", after={"lines": overrides})
    db.commit()
    db.refresh(b)
    return bill_out(db, b)


@router.get("/{code}")
@router.get("/{code}/print-data")
def get_bill_api(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("service_bill.create"))):
    return bill_out(db, get_bill(db, code, detail=True))


@router.patch("/{code}")
def update_bill(code: str, body: BillPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_bill.create"))):
    b = get_bill(db, code, lock=True)
    if b.status == "Paid":
        # Approved rule: financial fields lock after payment. Correction = Admin cancel + replacement bill.
        raise conflict("BILL_LOCKED", "Paid bills are locked. Cancel the bill and issue a replacement instead.")
    if b.status == "Cancelled":
        raise conflict("BILL_CANCELLED", "Cancelled bills can't be changed.")
    before = {"grand_total": money(b.grand_total), "items": [f"{i.quantity} x {i.service_name_snapshot} @ {money(i.rate)}" for i in b.items]}
    lines, subtotal, discount, overrides = build_lines(db, body.items, body.discount, user, b.items)
    for old in list(b.items):
        db.delete(old)
    db.flush()
    for x in lines:
        x.bill_id = b.id
        db.add(x)
    b.subtotal, b.discount, b.grand_total = subtotal, discount, subtotal - discount
    db.flush()
    db.refresh(b)
    audit(db, user.id, "BILL_UPDATED", "Service Bill", b.bill_code, f"Bill {b.bill_code} updated", before,
          {"grand_total": money(b.grand_total), "items": [f"{i.quantity} x {i.service_name_snapshot} @ {money(i.rate)}" for i in b.items]})
    if overrides:
        audit(db, user.id, "BILL_RATE_OVERRIDDEN", "Service Bill", b.bill_code, f"Rate override on {b.bill_code}", after={"lines": overrides})
    db.commit()
    return bill_out(db, b)


@router.post("/{code}/pay")
def pay_bill(code: str, body: PayIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key", max_length=120),
             db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_bill.create"))):
    b = get_bill(db, code, lock=True)
    if idempotency_key:
        prior = db.scalars(select(ServicePayment).where(ServicePayment.idempotency_key == idempotency_key)).first()
        if prior is not None:
            if prior.bill_id != b.id:
                raise conflict("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for another bill.")
            db.rollback()
            return bill_out(db, b) | {"replayed": True}
    if b.status == "Paid":
        raise conflict("BILL_ALREADY_PAID", "This bill is already paid.")
    if b.status == "Cancelled":
        raise conflict("BILL_CANCELLED", "Cancelled bills can't be paid.")
    if b.job.status == "Cancelled":  # QA-09: same rule as create_bill - a cancelled job doesn't collect money
        raise conflict("JOB_CANCELLED", "This service job was cancelled, so its bill can't be paid.")
    if b.grand_total <= 0:
        raise bad("ZERO_TOTAL", "A bill with a zero total can't be paid.")
    if body.payment_mode == "Bank" and not body.reference:
        raise bad("REFERENCE_REQUIRED", "Transaction / UTR reference is required for bank transfers.", "reference")
    if db.scalar(select(ServicePayment.id).join(ServiceBill).where(ServiceBill.job_id == b.job_id, ServiceBill.status == "Cancelled")):
        # DB handoff: never double-collect. The refund/adjustment rule for a cancelled paid bill is not decided yet.
        raise conflict("PREVIOUS_PAYMENT_UNRESOLVED", "This job's earlier bill was already paid and then cancelled. "
                       "Collecting again needs the refund/adjustment rule, which isn't decided yet.")
    at = now()
    db.add(ServicePayment(bill_id=b.id, amount=b.grand_total, payment_mode=body.payment_mode, reference=body.reference, paid_by=user.id,
                          paid_at=at, idempotency_key=idempotency_key))
    b.status, b.paid_by, b.paid_at = "Paid", user.id, at
    audit(db, user.id, "BILL_PAID", "Service Bill", b.bill_code, f"Full payment {money(b.grand_total)} received ({body.payment_mode})",
          {"status": "Unpaid"}, {"status": "Paid", "amount": money(b.grand_total), "mode": body.payment_mode})
    db.commit()
    return bill_out(db, b) | {"replayed": False}


@router.post("/{code}/cancel")
def cancel_bill(code: str, body: CancelIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_bill.cancel"))):
    b = get_bill(db, code, lock=True)
    if b.status == "Cancelled":
        raise conflict("BILL_ALREADY_CANCELLED", "This bill is already cancelled.")
    before = b.status
    b.status, b.cancelled_by, b.cancelled_at, b.cancellation_reason = "Cancelled", user.id, now(), body.reason
    # Items and any payment row are kept; revenue queries count status = 'Paid' only. No refund is assumed.
    audit(db, user.id, "BILL_CANCELLED", "Service Bill", b.bill_code, f"Bill {b.bill_code} cancelled ({money(b.grand_total)})",
          {"status": before, "grand_total": money(b.grand_total)}, {"status": "Cancelled"}, body.reason)
    db.commit()
    return bill_out(db, b)


class ShareIn(In):
    event_type: Literal["WHATSAPP_OPENED", "NATIVE_PDF_SHARE_OPENED"] = "WHATSAPP_OPENED"


@router.post("/{code}/share-events", status_code=204)
def bill_shared(code: str, body: ShareIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_bill.create"))):
    b = get_bill(db, code)
    action = "device PDF sharing opened" if body.event_type == "NATIVE_PDF_SHARE_OPENED" else "opened in WhatsApp"
    audit(db, user.id, "BILL_SHARED", "Service Bill", b.bill_code, f"Bill {b.bill_code} {action} ({body.event_type})")
    db.commit()
