"""Permission-checked PDF delivery and signed Meta webhook callbacks."""
import hashlib
import hmac
import json
import logging
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictBool, ValidationError, field_validator, model_validator
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .. import whatsapp_cloud as cloud
from ..common import In, audit, now
from ..config import settings
from ..db import SessionLocal, get_db
from ..document_pdf import render_pdf
from ..errors import AppError, bad, conflict
from ..models import FeeReceipt, Student, StudentPayment, WhatsAppDocumentDelivery as Delivery
from ..security import CurrentUser, require
from ..ratelimit import limited
from ..timing import timed_operation
from . import bills, fees

router = APIRouter(tags=["WhatsApp"])
log = logging.getLogger("ims.whatsapp")
STATUS_ORDER = {status: rank for rank, status in enumerate(("pending", "submitted", "sent", "delivered", "read"))}
MAX_WEBHOOK_BYTES = 1024 * 1024


class SendIn(In):
    opted_in: bool
    recipient: str = Field(pattern=r"^[1-9][0-9]{7,14}$")
    attempt_id: UUID


class BillSendIn(SendIn):
    model_config = ConfigDict(str_strip_whitespace=False)

    include_service_login: StrictBool = False
    service_login_password: Annotated[SecretStr, Field(min_length=1, max_length=256)] | None = None

    @field_validator("service_login_password")
    @classmethod
    def single_line_password(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and not value.get_secret_value().isprintable():
            raise ValueError("Enter a single-line password without control characters.")
        return value

    @model_validator(mode="after")
    def require_inclusion(self):
        if self.service_login_password is not None and not self.include_service_login:
            raise ValueError("Select Include Service Login Details in PDF before passing a password.")
        return self


def source(db: Session, kind: str, code: str, *, lock: bool = False, include_login: bool = False) -> tuple[bool, str | None, dict]:
    if kind == "receipt":
        row = fees.receipt_row(db, code, lock=lock)
        receipt, payment, student = row
        return payment.status == "Valid", cloud.normalize_number(fees.send_to(student)["whatsapp_number"]), receipt.snapshot
    bill = bills.get_bill(db, code, lock=lock, detail=lock)
    data = bills.bill_out(db, bill, include_login_username=include_login) if lock and bill.status == "Paid" else {}
    return bill.status == "Paid", cloud.normalize_number(bill.customer.whatsapp_number or bill.customer.mobile), data


def for_document(kind: str, code: str):
    return select(Delivery).where(Delivery.document_type == kind, Delivery.document_code == code)


def latest(db: Session, kind: str, code: str) -> Delivery | None:
    return db.scalar(for_document(kind, code).order_by((Delivery.status != "failed").desc(), Delivery.created_at.desc(), Delivery.id.desc()).limit(1))


def summary(eligible: bool, phone: str | None, delivery: Delivery | None) -> dict:
    return {
        "available": cloud.enabled(),
        "eligible": eligible,
        "recipient": phone,
        "delivery": {"status": delivery.status, "result_code": delivery.result_code,
                     "updated_at": delivery.updated_at, "recipient_last4": delivery.recipient[-4:]} if delivery else None,
    }


def status(db: Session, kind: str, code: str):
    if not cloud.enabled():
        return summary(False, None, None)
    eligible, phone, _ = source(db, kind, code)
    return summary(eligible, phone, latest(db, kind, code))


def send(db: Session, kind: str, code: str, body: SendIn, user: CurrentUser):
    if not cloud.enabled():
        raise AppError(503, "WHATSAPP_UNAVAILABLE", "Automatic delivery is unavailable. Use Open Chat & Save PDF.")
    if not body.opted_in:
        raise bad("WHATSAPP_CONSENT_REQUIRED", "Confirm the recipient opted in to receiving this document on WhatsApp.")
    include_login = isinstance(body, BillSendIn) and body.include_service_login
    eligible, phone, data = source(db, kind, code, lock=True, include_login=include_login)
    if not eligible:
        raise conflict("WHATSAPP_DOCUMENT_INELIGIBLE", "Automatic delivery requires a valid receipt or a paid bill.")
    if not phone:
        raise bad("WHATSAPP_INVALID_RECIPIENT", "Save a valid WhatsApp number on the recipient’s record.")
    if phone != body.recipient:
        raise conflict("WHATSAPP_RECIPIENT_CHANGED", "The saved number has changed. Refresh and confirm consent for the current number.")

    inserted = db.scalar(insert(Delivery).values(id=body.attempt_id, document_type=kind, document_code=code,
                                                 recipient=phone, status="pending", consent_by=user.id)
                         .on_conflict_do_nothing().returning(Delivery.id))
    if inserted is None:
        existing = db.scalar(for_document(kind, code).where(Delivery.id == body.attempt_id))
        existing = existing or latest(db, kind, code)
        if existing is None:
            raise conflict("WHATSAPP_REQUEST_REUSED", "Refresh and start a new delivery attempt.")
        return summary(eligible, phone, existing)
    service_login = None
    if isinstance(body, BillSendIn) and include_login:
        service_login = (data.get("service_login_username"),
                         body.service_login_password.get_secret_value() if body.service_login_password is not None else None)
    audit(db, user.id, "WHATSAPP_DOCUMENT_REQUESTED", "WhatsAppDelivery", str(inserted),
          f"WhatsApp {kind} delivery requested",
          after={"document": code, "consent_confirmed": True, "service_login_included": bool(service_login and any(service_login))})
    db.commit()  # The durable reservation prevents duplicates, even during a timeout or another request.

    filename = f"{'Receipt' if kind == 'receipt' else 'Service-Bill'}-{re.sub(r'[^A-Za-z0-9_-]', '_', code)}.pdf"
    try:
        with timed_operation("document_pdf"):
            pdf = render_pdf(kind, data, settings.whatsapp_pdf_font, service_login=service_login)
    except Exception as error:
        log.warning("Document PDF error type=%s", type(error).__name__)
        result = cloud.SendResult("failed", "pdf_unavailable")
    else:
        result = cloud.send_document(kind, phone, str(inserted), filename, pdf)

    delivery = db.scalar(select(Delivery).where(Delivery.id == inserted).with_for_update())
    # A webhook can arrive before the HTTP response. Keep the webhook's later status.
    if delivery.status == "pending":
        delivery.status, delivery.result_code, delivery.updated_at = result.status, result.code, now()
        delivery.provider_message_id = result.message_id
    db.commit()
    return summary(eligible, phone, delivery)


@router.get("/receipts/{code}/whatsapp-delivery")
def receipt_status(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("receipts.view_print"))):
    return status(db, "receipt", code)


@router.post("/receipts/{code}/whatsapp-delivery", dependencies=[Depends(limited("whatsapp"))])
def send_receipt(code: str, body: SendIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("receipts.view_print"))):
    return send(db, "receipt", code, body, user)


@router.get("/service-bills/{code}/whatsapp-delivery")
def bill_status(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("service_bill.create"))):
    return status(db, "bill", code)


@router.post("/service-bills/{code}/whatsapp-delivery", dependencies=[Depends(limited("whatsapp"))])
def send_bill(code: str, body: BillSendIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_bill.create"))):
    return send(db, "bill", code, body, user)


@router.get("/webhooks/whatsapp", include_in_schema=False)
def verify_webhook(mode: Annotated[str, Query(alias="hub.mode")] = "",
                   token: Annotated[str, Query(alias="hub.verify_token")] = "",
                   challenge: Annotated[str, Query(alias="hub.challenge")] = ""):
    secret = settings.whatsapp_verify_token.get_secret_value().encode()
    if mode != "subscribe" or not secret or not hmac.compare_digest(token.encode(), secret):
        return Response(status_code=403)
    return PlainTextResponse(challenge)


class MetaStatus(BaseModel):
    id: str
    status: str
    timestamp: int = Field(ge=0, le=9_223_372_036_854_775_807)
    recipient_id: str
    biz_opaque_callback_data: UUID | None = None
    errors: list[dict] = Field(default_factory=list)


def apply_updates(updates: list[MetaStatus]) -> None:
    with SessionLocal.begin() as db:
        for item in updates:
            message_id = cloud.provider_message_id(item.id)
            if not message_id or item.status not in ("sent", "delivered", "read", "failed"):
                continue
            match = Delivery.provider_message_id == message_id
            if item.biz_opaque_callback_data is not None:
                match = or_(match, Delivery.id == item.biz_opaque_callback_data)
            delivery = db.scalar(select(Delivery).where(match, Delivery.recipient == item.recipient_id).with_for_update())
            if delivery is None or delivery.provider_message_id not in (None, message_id) or delivery.status == "failed":
                continue
            if item.status == "failed":
                if STATUS_ORDER[delivery.status] >= STATUS_ORDER["delivered"] or item.timestamp < (delivery.provider_timestamp or 0):
                    continue
            elif STATUS_ORDER[item.status] <= STATUS_ORDER[delivery.status]:
                continue
            code = item.errors[0].get("code") if item.errors else None
            delivery.status, delivery.provider_message_id = item.status, message_id
            delivery.result_code = (f"meta_{code}" if type(code) is int else "delivery_failed") if item.status == "failed" else None
            delivery.provider_timestamp = max(item.timestamp, delivery.provider_timestamp or 0)
            delivery.updated_at = now()


def status_updates(payload) -> list[MetaStatus]:
    updates = []
    if not isinstance(payload, dict) or payload.get("object") != "whatsapp_business_account":
        return []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            if change.get("field") != "messages" or value.get("metadata", {}).get("phone_number_id") != settings.whatsapp_phone_number_id:
                continue
            for item in value.get("statuses", []):
                try:
                    updates.append(MetaStatus.model_validate(item))
                except ValidationError:
                    continue
    return updates


@router.post("/webhooks/whatsapp", include_in_schema=False, status_code=204)
async def delivery_webhook(request: Request, signature: Annotated[str, Header(alias="X-Hub-Signature-256")] = ""):
    secret = settings.whatsapp_app_secret.get_secret_value().encode()
    if not secret or not re.fullmatch(r"sha256=[a-f0-9]{64}", signature):
        return Response(status_code=403)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_WEBHOOK_BYTES:
            return Response(status_code=413)
        body.extend(chunk)
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return Response(status_code=403)
    try:
        updates = status_updates(json.loads(body))
    except (ValueError, AttributeError, TypeError):
        return Response(status_code=400)
    if updates:
        await run_in_threadpool(apply_updates, updates)
    return Response(status_code=204)
