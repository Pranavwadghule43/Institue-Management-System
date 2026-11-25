"""Service jobs: intake, status workflow (WF-07), assignments and private documents."""
import hashlib
import re
import uuid
from datetime import date
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from cryptography.fernet import Fernet, InvalidToken

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import Field, model_validator
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from ..common import In, OptStr, OptText, Paging, Str, apply_changes, audit, like, money, next_code, now, paging, today, user_names, user_ref
from ..config import settings
from ..db import get_db
from ..errors import AppError, bad, conflict, not_found
from ..models import AuditLog, Customer, File as FileRow, Service, ServiceBill, ServiceJob, ServiceJobDocument, ServiceJobEvent, ServiceJobItem, ServiceJobStaff, User
from ..security import CurrentUser, require
from ..ratelimit import limited
from .services import get_customer

router = APIRouter(prefix="/service-jobs", tags=["service jobs"])

OPEN = ("Pending", "In Process", "On Hold")
TRANSITIONS = {"Pending": {"In Process", "On Hold", "Cancelled"}, "In Process": {"Completed", "On Hold", "Cancelled"},
               "On Hold": {"In Process", "Cancelled"}, "Completed": set(), "Cancelled": set()}


class JobIn(In):
    customer_code: Str(40)
    service_ids: list[int] = Field(min_length=1, max_length=50)
    application_name: OptStr(200) = None
    service_date: date | None = None  # default: today
    due_date: date | None = None  # 16 Nov: client dropped "Last date" from New Job; still accepted from older clients
    notes: OptText = None

    @model_validator(mode="after")
    def _dates(self):
        if self.due_date is not None and self.due_date < (self.service_date or today()):
            raise ValueError("Last date can't be before the service date")
        return self


class JobPatch(In):
    application_name: OptStr(200) = None
    service_date: date | None = None
    due_date: date | None = None
    notes: OptText = None
    priority: Literal["Normal", "High", "Urgent"] | None = None


class StatusIn(In):
    status: Literal["Pending", "In Process", "On Hold", "Completed", "Cancelled"]
    reason: OptText = None


class AssignIn(In):
    user_ids: list[int] = Field(max_length=10)


def get_job(db: Session, code: str, lock: bool = False) -> ServiceJob:
    stmt = select(ServiceJob).where(ServiceJob.job_code == code)
    j = db.scalars(stmt.with_for_update() if lock else stmt).first()
    if j is None:
        raise not_found("service job")
    return j


def jobs_payload(db: Session, jobs: list[ServiceJob]) -> list[dict]:
    """Batch-load assignees and current bills for a page of jobs (no N+1)."""
    ids = [j.id for j in jobs]
    staff: dict[int, list] = {}
    for jid, uid, name in db.execute(select(ServiceJobStaff.job_id, User.id, User.full_name).join(User, User.id == ServiceJobStaff.user_id).where(ServiceJobStaff.job_id.in_(ids))):
        staff.setdefault(jid, []).append({"id": uid, "name": name})
    bills = {b.job_id: b for b in db.scalars(select(ServiceBill).where(ServiceBill.job_id.in_(ids), ServiceBill.status != "Cancelled"))}
    t = today()
    out = []
    for j in jobs:
        estimate = sum(i.rate_snapshot * i.quantity for i in j.items)
        bill = bills.get(j.id)
        overdue = j.status in OPEN and j.due_date is not None and j.due_date < t
        out.append({
            "code": j.job_code, "customer": {"code": j.customer.customer_code, "name": j.customer.full_name, "mobile": j.customer.mobile,
                                              "whatsapp_number": j.customer.whatsapp_number or j.customer.mobile},
            "services": [{"id": i.service_id, "name": i.service.name, "category": i.service.category.name, "quantity": i.quantity, "rate": money(i.rate_snapshot)} for i in j.items],
            "application_name": j.application_name, "service_date": j.service_date, "due_date": j.due_date, "status": j.status,
            "priority": j.priority, "notes": j.notes, "assignees": staff.get(j.id, []), "estimate": money(estimate),
            "amount": money(bill.grand_total if bill else estimate),
            "bill": {"code": bill.bill_code, "status": bill.status, "grand_total": money(bill.grand_total)} if bill else None,
            "overdue": overdue, "overdue_days": (t - j.due_date).days if overdue else 0,
            "created_at": j.created_at, "completed_at": j.completed_at})
    return out


@router.get("")
def list_jobs(q: str | None = None, status: Literal["Pending", "In Process", "On Hold", "Completed", "Cancelled"] | None = None,
              staff_id: int | None = None, assigned_to_me: bool = False, overdue: bool = False, customer_code: str | None = None,
              billable: bool = False, p: Paging = Depends(paging), db: Session = Depends(get_db),
              user: CurrentUser = Depends(require("service_jobs.view"))):
    stmt = select(ServiceJob).join(Customer, Customer.id == ServiceJob.customer_id)
    if billable:  # bill desk picker: not cancelled and no current (non-cancelled) bill
        stmt = stmt.where(ServiceJob.status != "Cancelled", ~exists().where(ServiceBill.job_id == ServiceJob.id, ServiceBill.status != "Cancelled"))
    if q:
        svc = exists().where(ServiceJobItem.job_id == ServiceJob.id, ServiceJobItem.service_id == Service.id, Service.name.ilike(like(q)))
        stmt = stmt.where(or_(ServiceJob.job_code.ilike(like(q)), Customer.full_name.ilike(like(q)), ServiceJob.application_name.ilike(like(q)), svc))
    if status:
        stmt = stmt.where(ServiceJob.status == status)
    who = user.id if assigned_to_me else staff_id
    if who:
        stmt = stmt.where(exists().where(ServiceJobStaff.job_id == ServiceJob.id, ServiceJobStaff.user_id == who))
    if overdue:
        stmt = stmt.where(ServiceJob.status.in_(OPEN), ServiceJob.due_date < today())
    if customer_code:
        stmt = stmt.where(Customer.customer_code == customer_code)
    counts = dict(db.execute(stmt.with_only_columns(ServiceJob.status, func.count()).group_by(ServiceJob.status)).all())
    total = sum(counts.values())
    jobs = db.scalars(stmt.options(selectinload(ServiceJob.items).joinedload(ServiceJobItem.service).joinedload(Service.category), joinedload(ServiceJob.customer))
                      .order_by(ServiceJob.created_at.desc(), ServiceJob.id.desc()).limit(p.page_size).offset((p.page - 1) * p.page_size)).all()
    return {"items": jobs_payload(db, jobs), "page": p.page, "page_size": p.page_size, "total": total, "pages": -(-total // p.page_size),
            "status_counts": {s: counts.get(s, 0) for s in TRANSITIONS}}


@router.post("", status_code=201)
def create_job(body: JobIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_jobs.create"))):
    customer = get_customer(db, body.customer_code)
    ids = list(dict.fromkeys(body.service_ids))
    services = {s.id: s for s in db.scalars(select(Service).where(Service.id.in_(ids)))}
    if len(services) != len(ids) or not all(s.is_active for s in services.values()):
        raise bad("SERVICE_INACTIVE", "Pick active services only.", "service_ids")
    j = ServiceJob(job_code=next_code(db, "JOB"), customer_id=customer.id, application_name=body.application_name,
                   service_date=body.service_date or today(), due_date=body.due_date, notes=body.notes, status="Pending", created_by=user.id)
    db.add(j)
    db.flush()
    for sid in ids:  # price snapshot at intake; the bill can still change quantities/rates later
        db.add(ServiceJobItem(job_id=j.id, service_id=sid, quantity=1, rate_snapshot=services[sid].customer_price))
    # ponytail: default assignment = the person creating the job (mirrors the UI); change via PUT /assignments.
    db.add(ServiceJobStaff(job_id=j.id, user_id=user.id))
    db.add(ServiceJobEvent(job_id=j.id, old_status=None, new_status="Pending", reason=body.notes or "Job created at counter", actor_id=user.id))
    audit(db, user.id, "JOB_CREATED", "Service Job", j.job_code, f"{j.job_code} created for {customer.full_name}")
    db.commit()
    db.refresh(j)
    return jobs_payload(db, [j])[0]


@router.get("/{code}")
def get_job_api(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("service_jobs.view"))):
    return jobs_payload(db, [get_job(db, code)])[0]


@router.patch("/{code}")
def update_job(code: str, body: JobPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_jobs.update"))):
    j = get_job(db, code, lock=True)
    if j.status not in OPEN:
        raise conflict("JOB_CLOSED", f"{j.status} jobs can't be edited.")
    data = body.model_dump(exclude_unset=True)
    if data.get("service_date", 0) is None:
        raise bad("FIELD_REQUIRED", "Service date is required.", "service_date")
    due, start = data.get("due_date", j.due_date), data.get("service_date", j.service_date)
    if due and due < start:
        raise bad("INVALID_DATES", "Last date can't be before the service date.", "due_date")
    before, after = apply_changes(j, data)
    if after:
        audit(db, user.id, "JOB_UPDATED", "Service Job", j.job_code, f"{j.job_code} updated", before, after)
    db.commit()
    return jobs_payload(db, [j])[0]


@router.post("/{code}/status")
def change_status(code: str, body: StatusIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_jobs.status"))):
    j = get_job(db, code, lock=True)
    if body.status not in TRANSITIONS[j.status]:
        raise conflict("INVALID_TRANSITION", f"A {j.status} job can't move to {body.status}.")
    if body.status in ("On Hold", "Cancelled") and len(body.reason or "") < 3:
        raise bad("REASON_REQUIRED", "A reason is required to put a job on hold or cancel it.", "reason")
    old = j.status
    j.status = body.status
    if body.status == "Completed":
        j.completed_at = now()
    db.add(ServiceJobEvent(job_id=j.id, old_status=old, new_status=body.status, reason=body.reason, actor_id=user.id))
    audit(db, user.id, "JOB_STATUS_CHANGED", "Service Job", j.job_code, f"{j.job_code}: {old} -> {body.status}", {"status": old}, {"status": body.status}, body.reason)
    db.commit()
    return jobs_payload(db, [j])[0]


@router.put("/{code}/assignments")
def assign(code: str, body: AssignIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_jobs.assign"))):
    j = get_job(db, code, lock=True)
    ids = set(body.user_ids)
    valid = set(db.scalars(select(User.id).where(User.id.in_(ids), User.is_active.is_(True), User.deleted_at.is_(None))))
    if valid != ids:
        raise bad("INVALID_STAFF", "Assign active staff accounts only.", "user_ids")
    current = set(db.scalars(select(ServiceJobStaff.user_id).where(ServiceJobStaff.job_id == j.id)))
    for uid in current - ids:
        db.delete(db.get(ServiceJobStaff, (j.id, uid)))
    for uid in ids - current:
        db.add(ServiceJobStaff(job_id=j.id, user_id=uid))
    if ids != current:
        names = user_names(db, ids | current)
        audit(db, user.id, "JOB_ASSIGNED", "Service Job", j.job_code, f"{j.job_code} assignment updated",
              {"assignees": sorted(names[i] for i in current)}, {"assignees": sorted(names[i] for i in ids)})
    db.commit()
    return jobs_payload(db, [j])[0]


@router.get("/{code}/events")
def events(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("service_jobs.view"))):
    """Status history plus document / assignment / edit entries from the audit log, newest first."""
    j = get_job(db, code)
    evs = db.scalars(select(ServiceJobEvent).where(ServiceJobEvent.job_id == j.id)).all()
    logs = db.scalars(select(AuditLog).where(AuditLog.entity_type == "Service Job", AuditLog.entity_id == j.job_code,
                                             AuditLog.action.in_(("JOB_ASSIGNED", "JOB_UPDATED", "DOCUMENT_UPLOADED", "DOCUMENT_DELETED")))).all()
    names = user_names(db, [e.actor_id for e in evs] + [a.actor_id for a in logs])
    out = [{"at": e.created_at, "type": "Created" if e.old_status is None else "Status", "old_status": e.old_status, "status": e.new_status,
            "note": e.reason, "by": user_ref(names, e.actor_id)} for e in evs]
    out += [{"at": a.created_at, "type": {"JOB_ASSIGNED": "Assigned", "JOB_UPDATED": "Note"}.get(a.action, "Document"), "status": None,
             "note": a.summary, "by": user_ref(names, a.actor_id)} for a in logs]
    return sorted(out, key=lambda e: e["at"], reverse=True)


# ----------------------------------------------------------------- documents

ALLOWED = {"pdf": ("application/pdf", b"%PDF-"), "png": ("image/png", b"\x89PNG\r\n\x1a\n"), "jpg": ("image/jpeg", b"\xff\xd8\xff"), "jpeg": ("image/jpeg", b"\xff\xd8\xff")}
_SENSITIVE = re.compile(r"aadhaar|aadhar|\bpan\b|bank|form ?16|passbook|cheque|voter|licen[cs]e|passport(?! ?photo)", re.I)
# 25 Nov 2026: IMS no longer accepts Aadhaar documents. ("aadhaar" stays in _SENSITIVE above so documents uploaded before
# this change remain restricted until the approved cleanup removes them.) "Udyog Aadhaar" is an MSME business
# registration, not a person's Aadhaar card, so it is not refused.
_AADHAAR_WORD = re.compile(r"(?<![a-z])(?P<prev>[a-z]+[^a-z]+)?(?:aadhaa?r|aadhar|adhaar|adhar)(?:card)?(?![a-z])")


def mentions_aadhaar(text: str) -> bool:
    """Whole words only (so names like "Adharsh" pass); "Udyog Aadhaar" (MSME registration) is not a person's Aadhaar."""
    for m in _AADHAAR_WORD.finditer((text or "").lower()):
        prev = (m.group("prev") or "").rstrip(" _-.")
        if prev != "udyog":
            return True
    return False


def refuse_aadhaar_document(document_type: str | None, filename: str) -> None:
    for field, value in (("document_type", document_type or ""), ("file", filename)):
        if mentions_aadhaar(value):
            raise bad("AADHAAR_NOT_COLLECTED", "Aadhaar documents are no longer collected by IMS. Don't upload them.", field)


# Types that are safe for every staff member with service_jobs.view. Anything else - including no type - is restricted.
NON_SENSITIVE_TYPES = frozenset({"passport photo", "photo", "photograph", "signature", "application form", "receipt", "challan",
                                 "acknowledgement"})


def is_sensitive(d: ServiceJobDocument) -> bool:
    """QA-03: identity/bank keywords anywhere -> restricted; otherwise restricted unless the type is known to be harmless.

    Until the DB lead adds service_job_documents.is_sensitive, this rule is the single source of truth.
    """
    label = f"{d.document_type or ''} {d.file.original_name}"
    if _SENSITIVE.search(label):
        return True
    return (d.document_type or "").strip().lower() not in NON_SENSITIVE_TYPES


def doc_out(d: ServiceJobDocument, user: CurrentUser, names: dict) -> dict:
    sensitive = is_sensitive(d)
    return {"id": d.id, "document_type": d.document_type, "original_name": d.file.original_name, "mime_type": d.file.mime_type,
            "size_bytes": d.file.size_bytes, "sensitive": sensitive, "can_view": not sensitive or user.can("service_documents.view_sensitive"),
            "uploaded_by": user_ref(names, d.uploaded_by), "created_at": d.created_at}


def _storage_root() -> Path:
    return Path(settings.file_storage_root).resolve()


# 23 Nov (SEC-06): documents are encrypted on disk with the server's data key (DATA_ENC_KEY), so a copy of the
# storage folder or its backup can't be read without the key. Files stored before this change stay readable: a
# Fernet token starts with "gAAAAA", which no PDF/JPG/PNG does.
_FERNET_PREFIX = b"gAAAAA"


def _seal(data: bytes) -> bytes:
    if not settings.data_enc_key:
        if settings.production:
            raise AppError(503, "STORAGE_KEY_MISSING", "Document storage is not configured on the server.")
        return data  # local development without a key
    return Fernet(settings.data_enc_key).encrypt(data)


def _open(raw: bytes) -> bytes:
    if not raw.startswith(_FERNET_PREFIX):
        return raw  # stored before encryption was added
    try:
        return Fernet(settings.data_enc_key or "").decrypt(raw)
    except (InvalidToken, ValueError):
        raise AppError(500, "DOCUMENT_DECRYPT_FAILED", "The stored document could not be read with the configured key.")


@router.get("/{code}/documents")
def list_documents(code: str, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_jobs.view"))):
    j = get_job(db, code)
    docs = db.scalars(select(ServiceJobDocument).options(joinedload(ServiceJobDocument.file))  # file rows in the same query (no N+1)
                      .where(ServiceJobDocument.job_id == j.id, ServiceJobDocument.deleted_at.is_(None)).order_by(ServiceJobDocument.created_at)).all()
    names = user_names(db, [d.uploaded_by for d in docs])
    return [doc_out(d, user, names) for d in docs]


@router.post("/{code}/documents", status_code=201, dependencies=[Depends(limited("upload"))])
def upload_document(code: str, file: UploadFile = File(...), document_type: str | None = Form(None, max_length=100),
                    db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_documents.upload"))):
    j = get_job(db, code)
    original = re.sub(r"[\x00-\x1f\\/]", "_", Path(file.filename or "document").name)[:255]
    refuse_aadhaar_document(document_type, original)
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in ALLOWED:
        raise bad("FILE_TYPE_NOT_ALLOWED", "Only PDF, JPG, JPEG and PNG files are allowed.", "file")
    limit = settings.max_upload_mb * 1024 * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise bad("FILE_TOO_LARGE", f"Files must be {settings.max_upload_mb} MB or smaller.", "file")
    mime, magic = ALLOWED[ext]
    if not data.startswith(magic):
        raise bad("FILE_TYPE_NOT_ALLOWED", "The file content doesn't match its type.", "file")
    key = f"jobs/{j.id}/{uuid.uuid4().hex}.{ext}"
    path = _storage_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(_seal(data))
        f = FileRow(storage_key=key, original_name=original, mime_type=mime, size_bytes=len(data), checksum=hashlib.sha256(data).hexdigest(), uploaded_by=user.id)
        db.add(f)
        db.flush()
        d = ServiceJobDocument(job_id=j.id, file_id=f.id, document_type=(document_type or "").strip() or None, uploaded_by=user.id)
        db.add(d)
        audit(db, user.id, "DOCUMENT_UPLOADED", "Service Job", j.job_code, f"{d.document_type or original} uploaded to {j.job_code}")
        db.commit()
    except Exception:
        path.unlink(missing_ok=True)  # don't leave orphan files when the DB write fails
        raise
    db.refresh(d)
    return doc_out(d, user, {user.id: user.full_name})


def _doc(db: Session, code: str, doc_id: int) -> tuple[ServiceJob, ServiceJobDocument]:
    j = get_job(db, code)
    d = db.get(ServiceJobDocument, doc_id)
    if d is None or d.job_id != j.id or d.deleted_at is not None:
        raise not_found("document")
    return j, d


@router.get("/{code}/documents/{doc_id}", dependencies=[Depends(limited("document"))])
def download_document(code: str, doc_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_jobs.view"))):
    j, d = _doc(db, code, doc_id)
    sensitive = is_sensitive(d)
    if sensitive and not user.can("service_documents.view_sensitive"):
        raise AppError(403, "SENSITIVE_DOCUMENT", "Ask the Admin for access to sensitive documents.")
    path = (_storage_root() / d.file.storage_key).resolve()
    if _storage_root() not in path.parents or not path.is_file():
        raise not_found("document file")
    data = _open(path.read_bytes())
    if d.file.checksum and hashlib.sha256(data).hexdigest() != d.file.checksum:
        raise AppError(500, "DOCUMENT_CHANGED", "The stored document doesn't match its checksum.")
    audit(db, user.id, "DOCUMENT_VIEWED", "Service Job", j.job_code, f"{d.file.original_name} opened{' (sensitive)' if sensitive else ''}")
    db.commit()
    name = quote(d.file.original_name)
    return Response(data, media_type=d.file.mime_type,
                    headers={"Content-Disposition": f"attachment; filename=\"{re.sub(r'[^A-Za-z0-9._-]', '_', d.file.original_name)}\"; filename*=UTF-8''{name}"})


@router.delete("/{code}/documents/{doc_id}", status_code=204)
def delete_document(code: str, doc_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require("service_documents.delete"))):
    j, d = _doc(db, code, doc_id)
    d.deleted_at = d.file.deleted_at = now()  # soft delete; the stored file is kept for audit
    audit(db, user.id, "DOCUMENT_DELETED", "Service Job", j.job_code, f"{d.file.original_name} deleted from {j.job_code}")
    db.commit()
