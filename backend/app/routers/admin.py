"""Administration: staff accounts (1 Admin + 4 Staff cap), per-user permissions, settings, audit log, backup history."""
import re
import secrets
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..common import (
    SEQUENCES, In, OptMobile, OptStr, OptText, Paging, Str, apply_changes, audit, bounds, institute, like, now, paginate, paging, today,
    user_ref,
)
from ..db import get_db
from ..errors import AppError, bad, not_found
from ..models import AccountLimit, AuditLog, BackupRun, InstituteSettings, NumberSequence, Permission, User, UserPermission
from ..security import ADMIN_ONLY, PERMISSIONS, CurrentUser, get_current_user, hash_password, require, revoke_sessions, role_label

router = APIRouter(tags=["administration"])
manage_staff = require("staff.manage")


def ensure_permission_catalog(db: Session) -> dict[str, int]:
    """Insert any missing permission codes (reference data); returns code -> id."""
    have = dict(db.execute(select(Permission.code, Permission.id)).all())
    for code, desc in PERMISSIONS:
        if code not in have:
            p = Permission(code=code, description=desc, admin_only=code in ADMIN_ONLY)
            db.add(p)
            db.flush()
            have[code] = p.id
    return have


# ----------------------------------------------------------------- staff


def staff_status(u: User) -> str:
    if not u.is_active:
        return "Disabled"
    if u.locked_until and u.locked_until > now():
        return "Locked"
    return "Active"


def staff_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "full_name": u.full_name, "role": role_label(u.role), "mobile": u.mobile,
            "designation": u.designation, "status": staff_status(u), "last_login_at": u.last_login_at, "created_at": u.created_at}


def account_limit(db: Session) -> dict:
    # Disabled accounts still count: deactivation does not free a slot (approved rule). Removed accounts
    # (deleted_at set) don't count - removing is how a slot is freed. Same rule as ims_enforce_user_account_limit.
    limit = select(AccountLimit.max_staff).where(AccountLimit.id == 1).scalar_subquery()
    admins, used, max_staff = db.execute(select(
        func.count().filter(User.role == "ADMIN"), func.count().filter(User.role == "STAFF"), func.coalesce(limit, 4)
    ).where(User.deleted_at.is_(None))).one()
    return {"admin_accounts": admins, "staff_used": used,
            "staff_limit": max_staff, "staff_remaining": max(0, max_staff - used)}


class StaffIn(In):
    full_name: Str(160)
    username: Str(100, 3)
    mobile: OptMobile = None
    designation: OptStr(120) = None

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.lower()
        if not re.fullmatch(r"[a-z0-9._]{3,}", v):
            raise ValueError("Lowercase letters, numbers, dot or underscore (min 3)")
        return v


class StaffPatch(In):
    full_name: Str(160) | None = None
    mobile: OptMobile = None
    designation: OptStr(120) = None


def _staff(db: Session, uid: int) -> User:
    u = db.get(User, uid)
    if u is None or u.deleted_at is not None:
        raise not_found("staff")
    return u


def _temp_password() -> str:
    return secrets.token_urlsafe(9)


@router.get("/directory/staff")
def staff_directory(db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    """Names only, for assignee pickers and filters available to every signed-in user."""
    users = db.scalars(select(User).where(User.deleted_at.is_(None), User.is_active.is_(True)).order_by(User.role, User.full_name)).all()
    return [{"id": u.id, "name": u.full_name, "role": role_label(u.role), "designation": u.designation} for u in users]


@router.get("/staff")
def list_staff(db: Session = Depends(get_db), _: CurrentUser = Depends(manage_staff)):
    users = db.scalars(select(User).where(User.deleted_at.is_(None)).order_by(User.role, User.full_name)).all()
    return {"items": [staff_out(u) for u in users], "account_limit": account_limit(db)}


@router.post("/staff", status_code=201)
def create_staff(body: StaffIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    # The DB trigger ims_enforce_user_account_limit locks account_limits and counts inside this transaction,
    # so two concurrent requests can't create Staff #5. Its error maps to 409 STAFF_ACCOUNT_LIMIT_REACHED.
    temp = _temp_password()
    u = User(username=body.username, full_name=body.full_name, mobile=body.mobile, designation=body.designation or "Staff",
             role="STAFF", password_hash=hash_password(temp), is_active=True)
    db.add(u)
    db.flush()
    audit(db, user.id, "STAFF_CREATED", "Staff", str(u.id), f"Staff account {u.username} created")
    db.commit()
    # Shown once so the Admin can hand it over in person; never stored in plain text or logged.
    return {"staff": staff_out(u), "temporary_password": temp, "account_limit": account_limit(db)}


@router.get("/staff/{uid}")
def get_staff(uid: int, db: Session = Depends(get_db), _: CurrentUser = Depends(manage_staff)):
    return staff_out(_staff(db, uid))


@router.patch("/staff/{uid}")
def update_staff(uid: int, body: StaffPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    u = _staff(db, uid)
    data = body.model_dump(exclude_unset=True)
    if "full_name" in data and data["full_name"] is None:
        raise bad("FIELD_REQUIRED", "Name is required.", "full_name")
    before, after = apply_changes(u, data)
    if after:
        audit(db, user.id, "STAFF_UPDATED", "Staff", str(u.id), f"Staff {u.username} updated", before, after)
    db.commit()
    return staff_out(u)


def _guard_other_staff(u: User, user: CurrentUser):
    if u.id == user.id or u.role == "ADMIN":
        raise AppError(400, "CANNOT_CHANGE_ADMIN", "The Admin account can't be disabled or locked from here.")


@router.post("/staff/{uid}/deactivate")
def deactivate_staff(uid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    u = _staff(db, uid)
    _guard_other_staff(u, user)
    if u.is_active:
        u.is_active = False
        revoke_sessions(db, u.id)  # signed out immediately
        audit(db, user.id, "STAFF_DEACTIVATED", "Staff", str(u.id), f"Staff {u.username} disabled")
    db.commit()
    return staff_out(u)


@router.post("/staff/{uid}/activate")
def activate_staff(uid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    u = _staff(db, uid)
    if not u.is_active:
        u.is_active = True
        audit(db, user.id, "STAFF_ACTIVATED", "Staff", str(u.id), f"Staff {u.username} enabled")
    db.commit()
    return staff_out(u)


@router.post("/staff/{uid}/remove")
def remove_staff(uid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    """Close a Staff account for good and free its slot. The row stays (soft delete) because receipts, payments,
    jobs and the audit log point at it, so the person's name keeps showing on their past work. Can't be undone,
    and the username stays reserved."""
    u = _staff(db, uid)
    if u.id == user.id or u.role == "ADMIN":
        raise AppError(400, "CANNOT_CHANGE_ADMIN", "The Admin account can't be removed.")
    u.is_active, u.deleted_at = False, now()
    revoke_sessions(db, u.id)  # signed out immediately
    audit(db, user.id, "STAFF_REMOVED", "Staff", str(u.id), f"Staff account {u.username} ({u.full_name}) removed; slot freed")
    db.commit()
    return {"removed": staff_out(u), "account_limit": account_limit(db)}


@router.post("/staff/{uid}/unlock")
def unlock_staff(uid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    u = _staff(db, uid)
    u.locked_until, u.failed_attempts = None, 0
    audit(db, user.id, "STAFF_UNLOCKED", "Staff", str(u.id), f"Staff {u.username} unlocked")
    db.commit()
    return staff_out(u)


@router.post("/staff/{uid}/reset-password")
def reset_password(uid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_staff)):
    u = _staff(db, uid)
    _guard_other_staff(u, user)
    temp = _temp_password()
    u.password_hash, u.locked_until, u.failed_attempts = hash_password(temp), None, 0
    revoke_sessions(db, u.id)
    audit(db, user.id, "PASSWORD_RESET", "Staff", str(u.id), f"Temporary password issued for {u.username}")
    db.commit()
    return {"staff": staff_out(u), "temporary_password": temp}


# ----------------------------------------------------------------- permissions


class PermissionsIn(In):
    codes: list[str] = Field(max_length=100)


@router.get("/permissions")
def permission_matrix(db: Session = Depends(get_db), _: CurrentUser = Depends(require("permissions.manage"))):
    grants: dict[int, list[str]] = {}
    for uid, code in db.execute(select(UserPermission.user_id, Permission.code).join(Permission)):
        grants.setdefault(uid, []).append(code)
    staff = db.scalars(select(User).where(User.role == "STAFF", User.deleted_at.is_(None)).order_by(User.full_name)).all()
    return {"catalog": [{"code": c, "description": d, "admin_only": c in ADMIN_ONLY} for c, d in PERMISSIONS],
            "staff": [staff_out(u) | {"permissions": sorted(set(grants.get(u.id, [])) - ADMIN_ONLY)} for u in staff]}


@router.put("/staff/{uid}/permissions")
def set_permissions(uid: int, body: PermissionsIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("permissions.manage"))):
    u = _staff(db, uid)
    if u.role != "STAFF":
        raise bad("NOT_STAFF", "The Admin already has full access.")
    codes = set(body.codes)
    catalog = {c for c, _ in PERMISSIONS}
    if codes - catalog:
        raise bad("UNKNOWN_PERMISSION", f"Unknown permission: {', '.join(sorted(codes - catalog))}", "codes")
    if codes & ADMIN_ONLY:
        raise bad("ADMIN_ONLY_PERMISSION", "Admin-only permissions can't be delegated.", "codes")
    ids = ensure_permission_catalog(db)
    current = set(db.scalars(select(Permission.code).join(UserPermission).where(UserPermission.user_id == u.id)))
    for code in current - codes:
        db.delete(db.get(UserPermission, (u.id, ids[code])))
    for code in codes - current:
        db.add(UserPermission(user_id=u.id, permission_id=ids[code]))
    changed = sorted(codes ^ current)
    if changed:
        audit(db, user.id, "PERMISSION_CHANGED", "Staff", str(u.id), f"{u.full_name}: {', '.join(changed)}",
              {c: "Allowed" if c in current else "Denied" for c in changed}, {c: "Allowed" if c in codes else "Denied" for c in changed})
    db.commit()
    return staff_out(u) | {"permissions": sorted(codes)}


# ----------------------------------------------------------------- settings


class InstituteIn(In):
    name: Str(180) | None = None
    tagline: OptStr(255) = None
    address: OptText = None
    phone: OptStr(30) = None
    email: OptStr(255) = None


class ReceiptSettingsIn(In):
    fee_receipt_prefix: str | None = Field(None, pattern=r"^[A-Z0-9]{1,6}$")
    service_bill_prefix: str | None = Field(None, pattern=r"^[A-Z0-9]{1,6}$")
    receipt_heading: OptStr(255) = None
    receipt_footer: OptText = None
    service_bill_footer: OptText = None
    service_bill_account_note: OptText = None


def _settings_row(db: Session) -> InstituteSettings:
    row = db.get(InstituteSettings, 1)
    if row is None:
        row = InstituteSettings(id=1, fee_receipt_prefix="RCP", service_bill_prefix="SB")
        db.add(row)
        db.flush()
    return row


def _preview(db: Session, kind: str, prefix: str) -> str:
    _, yearly, width = SEQUENCES[kind]
    period = str(today().year) if yearly else "GLOBAL"
    row = db.scalars(select(NumberSequence).where(NumberSequence.entity_type == kind, NumberSequence.period_key == period)).first()
    n, w = (row.next_value, row.width) if row else (1, width)
    return f"{prefix}-{period}-{n:0{w}d}" if yearly else f"{prefix}-{n:0{w}d}"


def settings_out(db: Session, s: InstituteSettings) -> dict:
    return {"institute": {"name": s.name, "tagline": s.tagline, "address": s.address, "phone": s.phone, "email": s.email, "timezone": s.timezone},
            "receipts": {"fee_receipt_prefix": s.fee_receipt_prefix, "service_bill_prefix": s.service_bill_prefix, "receipt_heading": s.receipt_heading,
                         "receipt_footer": s.receipt_footer, "service_bill_footer": s.service_bill_footer, "service_bill_account_note": s.service_bill_account_note,
                         "next_receipt_preview": _preview(db, "RECEIPT", s.fee_receipt_prefix), "next_bill_preview": _preview(db, "BILL", s.service_bill_prefix)},
            "updated_at": s.updated_at}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    return settings_out(db, institute(db))


def _patch_settings(db: Session, data: dict, user: CurrentUser, section: str) -> dict:
    s = _settings_row(db)
    if data.get("name", "x") is None:
        raise bad("FIELD_REQUIRED", "Institute name is required.", "name")
    for k in ("fee_receipt_prefix", "service_bill_prefix"):
        if k in data and data[k] is None:
            raise bad("FIELD_REQUIRED", "Prefix is required.", k)
    before, after = apply_changes(s, data)
    if after:  # new prefixes apply to the next issued number; issued receipts/bills keep theirs
        audit(db, user.id, "SETTINGS_UPDATED", "Settings", section, f"{section.capitalize()} settings updated", before, after)
    db.commit()
    return settings_out(db, s)


@router.patch("/settings/institute")
def patch_institute(body: InstituteIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("settings.manage"))):
    return _patch_settings(db, body.model_dump(exclude_unset=True), user, "institute")


@router.patch("/settings/receipts")
def patch_receipts(body: ReceiptSettingsIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("settings.manage"))):
    return _patch_settings(db, body.model_dump(exclude_unset=True), user, "receipts")


# ----------------------------------------------------------------- audit & deleted history

AUDIT_CATEGORIES = {"money": ("PAYMENT", "BILL", "EXPENSE", "RECEIPT"), "deleted": ("DELETED", "REVERSED", "CANCELLED", "ARCHIVED"),
                    "security": ("LOGIN", "LOGOUT", "PERMISSION", "PASSWORD", "BACKUP", "STAFF", "AADHAAR")}


@router.get("/audit")
def audit_log(q: str | None = None, category: Literal["all", "money", "deleted", "security"] = "all", actor_id: int | None = None,
              entity_type: str | None = None, action: str | None = None, date_from: date | None = None, date_to: date | None = None,
              p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require("audit.view"))):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    if category != "all":
        stmt = stmt.where(or_(*[AuditLog.action.like(f"%{w}%") for w in AUDIT_CATEGORIES[category]]))
    if q:
        stmt = stmt.where(or_(AuditLog.summary.ilike(like(q)), AuditLog.entity_id.ilike(like(q)), AuditLog.action.ilike(like(q))))
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if date_from or date_to:
        start, end = bounds(date_from or date(2000, 1, 1), date_to or today())
        stmt = stmt.where(AuditLog.created_at >= start, AuditLog.created_at < end)
    names = dict(db.execute(select(User.id, User.full_name)).all())
    return paginate(db, stmt, p, lambda a: {
        "id": a.id, "at": a.created_at, "actor": user_ref(names, a.actor_id) if a.actor_id else {"id": None, "name": "System"}, "category": a.category,
        "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "summary": a.summary, "reason": a.reason,
        "before": a.before_data, "after": a.after_data, "ip_address": a.ip_address})


# ----------------------------------------------------------------- backups


@router.get("/backups")
def backups(p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require("backup.create"))):
    """History only. Triggering backup/restore waits for the approved destination, encryption and retention policy;
    no endpoint pretends to run one."""
    stmt = select(BackupRun).order_by(BackupRun.started_at.desc())
    names = dict(db.execute(select(User.id, User.full_name)).all())
    return paginate(db, stmt, p, lambda b: {"id": b.id, "started_at": b.started_at, "finished_at": b.finished_at, "status": b.status,
                                            "size_bytes": b.size_bytes, "created_by": user_ref(names, b.created_by), "error": b.error_message},
                    backup_enabled=False)
