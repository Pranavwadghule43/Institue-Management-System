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
import threading
from dataclasses import dataclass, field
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, insert, select, update
from sqlalchemy.orm import Session

from .common import In, Str, audit, audit_values, now
from .config import settings
from .db import get_db
from .errors import AppError
from .models import AuditLog, LoginAttempt, Permission, User, UserPermission, UserSession
from .timing import timed_operation
from .whatsapp_cloud import enabled as whatsapp_delivery_enabled

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
    must_change_password: bool = False
    recovery_key_state: str = "never"  # never | set | used

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"

    def can(self, perm: str) -> bool:
        return self.is_admin or (perm not in ADMIN_ONLY and perm in self.permissions)


def role_label(role: str) -> str:
    return "Admin" if role == "ADMIN" else "Staff"


# SEC-12: scrypt at the OWASP cost (N=2^17 -> 128 MiB per hash). Only a few hashes run at once, so a flood of
# sign-in requests queues instead of exhausting the server's memory. Older hashes (N=2^14) still verify and are
# upgraded the next time that user signs in.
_hash_slots = threading.BoundedSemaphore(max(1, settings.password_hash_parallel))


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    with _hash_slots:
        return hashlib.scrypt(password.encode(), salt=salt, n=n, r=r, p=p, maxmem=128 * r * n * p + 1024 * 1024 * 4)


def hash_password(password: str) -> str:
    salt, n = os.urandom(16), settings.password_hash_n
    dk = _scrypt(password, salt, n, 8, 1)
    return f"scrypt${n}$8$1$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def verify_password(password: str, stored: str | None) -> bool:
    try:
        algo, n, r, p, salt, dk = (stored or "").split("$")
        if algo != "scrypt" or int(n) > 2**20 or int(r) > 16 or int(p) > 4:
            return False
        got = _scrypt(password, base64.b64decode(salt), int(n), int(r), int(p))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except ValueError:
        return False


def needs_rehash(stored: str | None) -> bool:
    try:
        return int((stored or "").split("$")[1]) < settings.password_hash_n
    except (IndexError, ValueError):
        return False


# Verified against when the username doesn't exist, so unknown and real usernames take the same time (QA-17).
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))

# Password policy (QA-16): length + variety + not common + not the username. No forced expiry or symbol rules.
MIN_PASSWORD_LENGTH = 10
COMMON_PASSWORDS = frozenset({
    "password", "password1", "password12", "password123", "password@123", "passw0rd", "p@ssw0rd", "p@ssword123", "123456789",
    "1234567890", "12345678910", "0123456789", "9876543210", "qwertyuiop", "qwerty123", "qwerty1234", "1q2w3e4r5t", "1qaz2wsx3edc",
    "asdfghjkl", "zxcvbnm123", "iloveyou12", "welcome123", "welcome@123", "admin12345", "admin@123", "admin@1234", "administrator",
    "letmein123", "changeme123", "india@123", "india12345", "updaate123", "updaate@123", "update@123", "computer123", "abc1234567",
})


def password_problem(password: str, username: str | None = None) -> str | None:
    """Why a new password is too weak, or None when it is acceptable."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Use at least {MIN_PASSWORD_LENGTH} characters."
    if len(set(password)) < 4:
        return "Use a mix of different characters."
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS:
        return "This password is too common. Choose another."
    if username and len(username) >= 3 and username.lower() in lowered:
        return "Don't include your username in the password."
    return None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


_bearer = HTTPBearer(auto_error=False)


# While an account must first change its temporary password (SEC-05), only these endpoints answer; everything else
# returns 403 PASSWORD_CHANGE_REQUIRED so the app can show the Change password screen.
RESTRICTED_ALLOWED = ("/auth/me", "/auth/logout", "/auth/change-password")


def get_current_user(request: Request, cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
                     db: Session = Depends(get_db)) -> CurrentUser:
    if cred is None:
        raise AppError(401, "UNAUTHENTICATED", "Sign in to continue.")
    # Session, user and permission codes in ONE round trip (performance): one row per permission, or a single row
    # with code NULL when the user has none. Same conditions and same result as the former two separate queries.
    rows = db.execute(
        select(UserSession, User, Permission.code).join(User, User.id == UserSession.user_id)
        .outerjoin(UserPermission, UserPermission.user_id == User.id).outerjoin(Permission, Permission.id == UserPermission.permission_id)
        .where(UserSession.token_hash == token_hash(cred.credentials), UserSession.revoked_at.is_(None),
               UserSession.expires_at > now(), User.is_active.is_(True), User.deleted_at.is_(None))
    ).all()
    if not rows:
        raise AppError(401, "SESSION_INVALID", "Your session has expired. Please sign in again.")
    s, u, _ = rows[0]
    perms = frozenset(code for *_, code in rows if code is not None)
    t = now()
    if s.last_activity_at and t - s.last_activity_at > timedelta(minutes=settings.session_idle_minutes):
        s.revoked_at = t
        db.commit()
        raise AppError(401, "SESSION_EXPIRED", "You were signed out after a period of inactivity.")
    if s.last_activity_at is None or t - s.last_activity_at > timedelta(seconds=60):  # at most one write per minute per session
        s.last_activity_at = t
        db.commit()
    if u.must_change_password and request.url.path.removeprefix(settings.api_v1_prefix) not in RESTRICTED_ALLOWED:
        raise AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change your temporary password to continue.")
    return CurrentUser(u.id, u.username, u.full_name, u.role, u.designation, perms, s.id,
                       bool(u.must_change_password), recovery_key_state(u))


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
    out = {"id": u.id, "username": u.username, "full_name": u.full_name, "role": role_label(u.role),
           "designation": u.designation, "permissions": sorted(ALL_CODES if u.is_admin else u.permissions - ADMIN_ONLY),
           "whatsapp_document_delivery": whatsapp_delivery_enabled(), "must_change_password": u.must_change_password}
    # Every account keeps a one-time recovery key for a forgotten password. Without one (first sign-in, or after the
    # Admin reset the password) the app shows the key once, right after sign-in.
    out["recovery_key_set"] = u.recovery_key_state == "set"
    out["recovery_key_reminder"] = u.recovery_key_state != "set"
    return out


# ----------------------------------------------------------------- auth routes

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(In):
    username: Str(100)
    password: Str(200)


class PasswordIn(In):
    current_password: Str(200)
    new_password: Str(128, 8)


IP_FAILURE_LIMIT = 20  # failed sign-ins per IP per lock window, across all usernames


def wait_seconds(failures: int) -> int:
    """SEC-03: no hard lock. From the 5th wrong password on, each new try must wait longer:
    30 s, 1 min, 2 min, 4 min, 8 min, then 15 min at most (LOGIN_WAIT_SECONDS / LOGIN_LOCK_MINUTES)."""
    extra = max(0, failures - settings.login_max_attempts)
    return min(settings.login_wait_seconds * 2 ** min(extra, 20), settings.login_lock_minutes * 60)


def _wait_message(seconds: int) -> str:
    when = f"{seconds} seconds" if seconds < 90 else f"{round(seconds / 60)} minutes"
    return f"Too many wrong attempts. Try again in {when}."


def _address_blocked(db: Session, ip: str | None, username: str, since) -> bool:
    """SEC-03: after 20 failures from one address, only the names that already failed from it are stopped, so wrong
    tries on other names can't keep the Admin (or anyone else on the same network) out."""
    if not ip:
        return False
    failures = select(func.count()).where(LoginAttempt.ip_address == ip, LoginAttempt.succeeded.is_(False), LoginAttempt.attempted_at > since)
    if (db.scalar(failures) or 0) < IP_FAILURE_LIMIT:
        return False
    # A successful sign-in or recovery-key reset proves the owner: only failures after it count against the name.
    last_ok = db.scalar(select(func.max(LoginAttempt.attempted_at)).where(
        LoginAttempt.ip_address == ip, LoginAttempt.username == username[:100], LoginAttempt.succeeded.is_(True)))
    after = max(since, last_ok) if last_ok else since
    return bool(db.scalar(failures.where(LoginAttempt.username == username[:100], LoginAttempt.attempted_at > after)))


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    username = body.username.lower()
    # Row lock (QA-04): parallel sign-ins for one account run one at a time, so every wrong password is counted
    # and the wait can't be bypassed by sending guesses simultaneously. Released at commit/rollback.
    u = db.scalars(select(User).where(User.username == username, User.deleted_at.is_(None)).with_for_update()).first()
    ip = request.client.host if request.client else None
    t = now()

    def fail(status=401, code="INVALID_CREDENTIALS", msg="Incorrect username or password.", headers=None):
        db.add(LoginAttempt(username=username[:100], succeeded=False, ip_address=ip))
        db.commit()
        raise AppError(status, code, msg, headers=headers)

    if _address_blocked(db, ip, username, t - timedelta(minutes=settings.login_lock_minutes)):
        raise AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-ins from this device. Try again later.",
                       headers={"Retry-After": str(settings.login_lock_minutes * 60)})
    active = u is not None and u.is_active
    if active and u.locked_until and u.locked_until > t:
        # During the wait nothing is checked, so the wait can't be used to test passwords.
        seconds = max(1, int((u.locked_until - t).total_seconds()))
        fail(429, "LOGIN_LOCKED", _wait_message(seconds), headers={"Retry-After": str(seconds)})
    with timed_operation("password_verify"):
        valid = verify_password(body.password, u.password_hash if active else DUMMY_HASH)
    if not active:
        fail()
    if not valid:
        u.failed_attempts += 1
        if u.failed_attempts >= settings.login_max_attempts:
            seconds = wait_seconds(u.failed_attempts)
            u.locked_until = t + timedelta(seconds=seconds)
            audit(db, u.id, "LOGIN_LOCKED", "Auth", u.username, f"{u.failed_attempts} failed attempts, next try in {seconds} s")
        fail()
    if needs_rehash(u.password_hash):
        u.password_hash = hash_password(body.password)  # SEC-12: upgrade older, cheaper hashes on sign-in
    token = secrets.token_urlsafe(32)
    signed_in_at = t
    expires = signed_in_at + timedelta(hours=settings.session_hours)
    # The user row remains locked from the initial lookup. Group disjoint writes and
    # the permission lookup in one round trip. A failure rolls back the whole login.
    db.flush()
    updates = update(User.__table__).where(User.id == u.id).values(failed_attempts=0, locked_until=None, last_login_at=signed_in_at)
    session = insert(UserSession.__table__).values(user_id=u.id, token_hash=token_hash(token), expires_at=expires, last_activity_at=signed_in_at)
    attempt = insert(LoginAttempt.__table__).values(username=username, succeeded=True, ip_address=ip)
    entry = insert(AuditLog.__table__).values(**audit_values(u.id, "LOGIN_SUCCESS", "Auth", u.username, "Signed in"))
    permissions = select(Permission.code).join(UserPermission).where(UserPermission.user_id == u.id).add_cte(
        updates.cte("user_login"), session.cte("new_session"), attempt.cte("successful_attempt"), entry.cte("audit_login"))
    cu = CurrentUser(u.id, u.username, u.full_name, u.role, u.designation, frozenset(db.scalars(permissions)), None,
                     bool(u.must_change_password), recovery_key_state(u))
    db.commit()
    return {"token": token, "token_type": "bearer", "expires_at": expires, "user": me_payload(cu)}


# ----------------------------------------------------------------- forgotten password: recovery key

# Every account (Admin and Staff) keeps a one-time recovery key, shown once in the app right after sign-in and stored
# only as a hash. With it, a forgotten password is reset from the sign-in page; the reset hands out a new key at once.
# No key either? The Admin resets a staff password (Staff page); the server console resets any account.
RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I/L


def recovery_key_state(u: User) -> str:
    """set = a usable key exists; anything else means the app should hand out a new one."""
    if not u.recovery_key_hash:
        return "never"
    return "set" if u.recovery_key_hash.startswith("scrypt$") else "used"


def new_recovery_key() -> str:
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(25))  # 25 x log2(31) = 124 bits
    return "-".join(raw[i:i + 5] for i in range(0, 25, 5))


def _clean_key(key: str) -> str:
    return "".join(ch for ch in key.upper() if ch in RECOVERY_ALPHABET)


class RecoveryKeyIn(In):
    current_password: Str(200)


@router.post("/recovery-key")
def create_recovery_key(body: RecoveryKeyIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Shown once. A new key replaces the old one. Any account, after confirming its password."""
    u = db.scalars(select(User).where(User.id == user.id).with_for_update()).one()
    if not verify_password(body.current_password, u.password_hash):
        raise AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect.", {"current_password": "Current password is incorrect."})
    key = new_recovery_key()
    u.recovery_key_hash = hash_password(_clean_key(key))
    audit(db, u.id, "RECOVERY_KEY_CREATED", "Auth", u.username, "Recovery key created (any earlier key no longer works)")
    db.commit()
    return {"recovery_key": key}


class RecoverIn(In):
    username: Str(100)
    recovery_key: Str(60)
    new_password: Str(128, 8)


@router.post("/recover")
def recover(body: RecoverIn, request: Request, db: Session = Depends(get_db)):
    """Forgotten password: username + recovery key + new password. The key works once, so the answer carries the
    account's next key (shown once on the sign-in page); all sessions end.
    Wrong keys count like wrong passwords (same wait and per-address limit). The key is long enough (124 bits) that
    it also works during a wait, so someone guessing the password can't keep the Admin out."""
    username = body.username.lower()
    u = db.scalars(select(User).where(User.username == username, User.deleted_at.is_(None)).with_for_update()).first()
    ip = request.client.host if request.client else None
    t = now()
    usable = u is not None and u.is_active and recovery_key_state(u) == "set"
    valid = verify_password(_clean_key(body.recovery_key), u.recovery_key_hash if usable else DUMMY_HASH)
    if not (usable and valid):
        db.add(LoginAttempt(username=username[:100], succeeded=False, ip_address=ip))
        if u is not None and u.is_active:
            u.failed_attempts += 1
            if u.failed_attempts >= settings.login_max_attempts:
                u.locked_until = t + timedelta(seconds=wait_seconds(u.failed_attempts))
        db.commit()
        raise AppError(400, "RECOVERY_FAILED", "Username or recovery key is incorrect.")
    if problem := password_problem(body.new_password, u.username):
        db.rollback()
        raise AppError(400, "PASSWORD_TOO_WEAK", problem, {"new_password": problem})
    next_key = new_recovery_key()
    u.password_hash = hash_password(body.new_password)
    u.recovery_key_hash, u.must_change_password, u.failed_attempts, u.locked_until = hash_password(_clean_key(next_key)), False, 0, None
    revoke_sessions(db, u.id)
    db.add(LoginAttempt(username=username[:100], succeeded=True, ip_address=ip))
    audit(db, u.id, "PASSWORD_RECOVERED", "Auth", u.username, "Password reset with the recovery key; new key issued; all sessions signed out")
    db.commit()
    return {"recovery_key": next_key}


def reset_password_console(db: Session, username: str, password: str) -> User:
    """Last resort on the server: python -m app.cli reset-password USERNAME (password prompted, never echoed)."""
    u = db.scalars(select(User).where(User.username == username.lower(), User.deleted_at.is_(None))).first()
    if u is None:
        raise SystemExit(f"No account named {username}.")
    if problem := password_problem(password, u.username):
        raise SystemExit(problem)
    u.password_hash, u.failed_attempts, u.locked_until, u.must_change_password = hash_password(password), 0, None, False
    revoke_sessions(db, u.id)
    audit(db, u.id, "PASSWORD_RESET_CONSOLE", "Auth", u.username, "Password reset from the server console; all sessions signed out")
    db.commit()
    return u


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
    if problem := password_problem(body.new_password, u.username):
        raise AppError(400, "PASSWORD_TOO_WEAK", problem, {"new_password": problem})
    u.password_hash = hash_password(body.new_password)
    u.must_change_password = False
    for s in db.scalars(select(UserSession).where(UserSession.user_id == u.id, UserSession.revoked_at.is_(None), UserSession.id != user.session_id)):
        s.revoked_at = now()  # other devices are signed out; this one stays
    audit(db, u.id, "PASSWORD_CHANGED", "Auth", u.username, "Password changed")
    db.commit()
