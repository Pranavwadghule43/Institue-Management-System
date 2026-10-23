"""SECURITY INTEGRATION SEAM - owned by the security developer (Dhruvank).

Business routes only use: get_current_user, require(perm), require_admin, CurrentUser.can().
This module is a working implementation on the approved users / user_sessions / login_attempts
tables so the API is usable today; the security developer can replace the internals (hashing,
token lifecycle, lockout policy) without touching business code.
"""
import base64
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass, field
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .common import In, Str, audit, now
from .config import settings
from .db import get_db
from .errors import AppError
from .models import LoginAttempt, Permission, User, UserPermission, UserSession

# (code, description) grouped as in the React Permissions page.
PERMISSIONS: list[tuple[str, str]] = [
    ("students.view", "View students and enquiries"), ("students.create", "Create enquiries and admissions"),
    ("students.edit", "Edit students"), ("students.delete", "Archive students"),
    ("courses.manage", "Manage courses"), ("batches.manage", "Manage batches"),
    ("fees.view", "View fees"), ("fees.collect", "Collect fees"), ("payments.delete_or_reverse", "Reverse payments"),
    ("receipts.view_print", "Print receipts"), ("reminders.view", "Fee reminders"),
    ("customers.view", "View customers"), ("customers.manage", "Manage customers"),
    ("service_jobs.view", "View jobs"), ("service_jobs.create", "Create jobs"), ("service_jobs.update", "Update jobs"),
    ("service_jobs.assign", "Assign staff"), ("service_jobs.status", "Change job status"),
    ("service_documents.upload", "Upload documents"), ("service_documents.view_sensitive", "View sensitive documents"),
    ("service_documents.delete", "Delete documents"), ("service_bill.create", "Create service bills"),
    ("expenses.view", "View expenses"), ("expenses.create", "Add expenses"), ("expenses.edit_delete", "Edit / delete expenses"),
    ("reports.view", "View reports"), ("audit.view", "View audit log"),
    ("service_master.manage", "Service master"), ("service_bill.rate_override", "Override bill rate"),
    ("service_bill.edit_after_payment", "Edit paid bills"), ("service_bill.cancel", "Cancel bills"),
    ("staff.manage", "Manage staff"), ("permissions.manage", "Manage permissions"),
    ("backup.create", "Create backup"), ("backup.restore", "Restore backup"), ("settings.manage", "Settings"),
]
# Admin-only per the UI catalog, plus payment reversal (Admin-only per the DB handoff, section 4).
ADMIN_ONLY = frozenset({
    "service_master.manage", "service_bill.rate_override", "service_bill.edit_after_payment", "service_bill.cancel",
    "staff.manage", "permissions.manage", "backup.create", "backup.restore", "settings.manage", "payments.delete_or_reverse",
})
ALL_CODES = frozenset(c for c, _ in PERMISSIONS)


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    full_name: str
    role: str  # ADMIN | STAFF
    designation: str | None = None
    permissions: frozenset[str] = field(default_factory=frozenset)
    session_id: int | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"

    def can(self, perm: str) -> bool:
        return self.is_admin or (perm not in ADMIN_ONLY and perm in self.permissions)


def role_label(role: str) -> str:
    return "Admin" if role == "ADMIN" else "Staff"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$16384$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str | None) -> bool:
    try:
        algo, n, r, p, salt, dk = (stored or "").split("$")
        got = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p))
        return algo == "scrypt" and hmac.compare_digest(got, base64.b64decode(dk))
    except ValueError:
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def user_permissions(db: Session, user_id: int) -> frozenset[str]:
    return frozenset(db.scalars(select(Permission.code).join(UserPermission).where(UserPermission.user_id == user_id)))


_bearer = HTTPBearer(auto_error=False)


def get_current_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> CurrentUser:
    if cred is None:
        raise AppError(401, "UNAUTHENTICATED", "Sign in to continue.")
    row = db.execute(
        select(UserSession, User).join(User, User.id == UserSession.user_id).where(
            UserSession.token_hash == token_hash(cred.credentials), UserSession.revoked_at.is_(None),
            UserSession.expires_at > now(), User.is_active.is_(True), User.deleted_at.is_(None))
    ).first()
    if row is None:
        raise AppError(401, "SESSION_INVALID", "Your session has expired. Please sign in again.")
    s, u = row
    t = now()
    if s.last_activity_at and t - s.last_activity_at > timedelta(minutes=settings.session_idle_minutes):
        s.revoked_at = t
        db.commit()
        raise AppError(401, "SESSION_EXPIRED", "You were signed out after a period of inactivity.")
    if s.last_activity_at is None or t - s.last_activity_at > timedelta(seconds=60):  # at most one write per minute per session
        s.last_activity_at = t
        db.commit()
    return CurrentUser(u.id, u.username, u.full_name, u.role, u.designation, user_permissions(db, u.id), s.id)


def require(perm: str):
    def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not user.can(perm):
            raise AppError(403, "FORBIDDEN", "You do not have permission for this action.")
        return user
    return dep


def require_any(*perms: str):
    def dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not any(user.can(p) for p in perms):
            raise AppError(403, "FORBIDDEN", "You do not have permission for this action.")
        return user
    return dep


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise AppError(403, "ADMIN_ONLY", "Only the Admin can perform this action.")
    return user


def revoke_sessions(db: Session, user_id: int) -> None:
    for s in db.scalars(select(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))):
        s.revoked_at = now()


def me_payload(u: CurrentUser) -> dict:
    return {"id": u.id, "username": u.username, "full_name": u.full_name, "role": role_label(u.role),
            "designation": u.designation, "permissions": sorted(ALL_CODES if u.is_admin else u.permissions - ADMIN_ONLY)}


# ----------------------------------------------------------------- auth routes

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(In):
    username: Str(100)
    password: Str(200)


class PasswordIn(In):
    current_password: Str(200)
    new_password: Str(128, 8)


IP_FAILURE_LIMIT = 20  # failed sign-ins per IP per lock window, across all usernames


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    username = body.username.lower()
    u = db.scalars(select(User).where(User.username == username, User.deleted_at.is_(None))).first()
    ip = request.client.host if request.client else None

    def fail(status=401, code="INVALID_CREDENTIALS", msg="Incorrect username or password."):
        db.add(LoginAttempt(username=username[:100], succeeded=False, ip_address=ip))
        db.commit()
        raise AppError(status, code, msg)

    window = now() - timedelta(minutes=settings.login_lock_minutes)
    if ip and (db.scalar(select(func.count()).where(LoginAttempt.ip_address == ip, LoginAttempt.succeeded.is_(False),
                                                    LoginAttempt.attempted_at > window)) or 0) >= IP_FAILURE_LIMIT:
        raise AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-ins from this device. Try again later.")
    if u is None or not u.is_active:
        fail()
    if u.locked_until and u.locked_until > now():
        fail(429, "LOGIN_LOCKED", "Too many attempts. Sign-in is paused, try again later.")
    if not verify_password(body.password, u.password_hash):
        u.failed_attempts += 1
        if u.failed_attempts >= settings.login_max_attempts:
            u.locked_until, u.failed_attempts = now() + timedelta(minutes=settings.login_lock_minutes), 0
            audit(db, u.id, "LOGIN_LOCKED", "Auth", u.username, f"{settings.login_max_attempts} failed attempts, account locked")
        fail()
    token = secrets.token_urlsafe(32)
    u.failed_attempts, u.locked_until, u.last_login_at = 0, None, now()
    expires = now() + timedelta(hours=settings.session_hours)
    db.add(UserSession(user_id=u.id, token_hash=token_hash(token), expires_at=expires, last_activity_at=now()))
    db.add(LoginAttempt(username=username, succeeded=True, ip_address=ip))
    audit(db, u.id, "LOGIN_SUCCESS", "Auth", u.username, "Signed in")
    db.commit()
    cu = CurrentUser(u.id, u.username, u.full_name, u.role, u.designation, user_permissions(db, u.id))
    return {"token": token, "token_type": "bearer", "expires_at": expires, "user": me_payload(cu)}


@router.post("/logout", status_code=204)
def logout(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    s = db.get(UserSession, user.session_id)
    s.revoked_at = now()
    audit(db, user.id, "LOGOUT", "Auth", user.username, "Signed out")
    db.commit()


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return me_payload(user)


@router.post("/change-password", status_code=204)
def change_password(body: PasswordIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.get(User, user.id)
    if not verify_password(body.current_password, u.password_hash):
        raise AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect.", {"current_password": "Current password is incorrect."})
    if body.new_password == body.current_password:
        raise AppError(400, "PASSWORD_UNCHANGED", "Choose a different password.", {"new_password": "Choose a different password."})
    u.password_hash = hash_password(body.new_password)
    for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id, UserSession.revoked_at.is_(None), UserSession.id != user.session_id)):
        s.revoked_at = now()  # other devices are signed out; this one stays
    audit(db, u.id, "PASSWORD_CHANGED", "Auth", u.username, "Password changed")
    db.commit()
