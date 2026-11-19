"""Shared helpers: request models, validators, money, time, pagination, audit, numbering, Aadhaar."""
import hashlib
import hmac
import re
import calendar
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated, Literal

from cryptography.fernet import Fernet, InvalidToken
from fastapi import Query
from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .config import settings
from .errors import AppError
from .models import AuditLog, InstituteSettings, NumberSequence

# ----------------------------------------------------------------- request models / validators


class In(BaseModel):
    """Base for request bodies: unknown fields are rejected, so clients can't send totals or IDs."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


PayMode = Literal["Cash", "GPay", "PhonePe", "UPI", "Card", "Bank"]
PAY_MODES: tuple[str, ...] = ("Cash", "GPay", "PhonePe", "UPI", "Card", "Bank")
PAY_LABEL = {"Cash": "Cash", "GPay": "GPay", "PhonePe": "PhonePe", "UPI": "Other UPI", "Card": "Card", "Bank": "Bank transfer"}


def _blank_none(v):
    return None if isinstance(v, str) and not v.strip() else v


def _mobile(v):
    d = re.sub(r"\D", "", str(v))
    if len(d) == 12 and d.startswith("91"):
        d = d[2:]
    if not re.fullmatch(r"[6-9]\d{9}", d):
        raise ValueError("Enter a valid 10-digit Indian mobile number")
    return d


def _aadhaar(v):
    d = re.sub(r"\D", "", str(v))
    if len(d) != 12:
        raise ValueError("Aadhaar must contain 12 digits")
    return d


def _email(v):
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v):
        raise ValueError("Enter a valid email address")
    return v


Mobile = Annotated[str, BeforeValidator(_mobile)]
OptMobile = Annotated[str | None, BeforeValidator(lambda v: None if _blank_none(v) is None else _mobile(v))]
OptAadhaar = Annotated[str | None, BeforeValidator(lambda v: None if _blank_none(v) is None else _aadhaar(v))]
# QA-01: length/format apply to the string branch only; blank or null means "no email" (was a 500 on None).
OptEmail = Annotated[Annotated[str, StringConstraints(strip_whitespace=True, max_length=255), AfterValidator(_email)] | None, BeforeValidator(_blank_none)]
OptText = Annotated[Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None, BeforeValidator(_blank_none)]


def Str(max_length: int, min_length: int = 1):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)]


def OptStr(max_length: int):
    return Annotated[Annotated[str, StringConstraints(strip_whitespace=True, max_length=max_length)] | None, BeforeValidator(_blank_none)]


Money = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2, allow_inf_nan=False)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)]
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=1000)]

# ----------------------------------------------------------------- money / dates

CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def q2(v) -> Decimal:
    return Decimal(v or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def money(v) -> str | None:
    """Money goes out as a 2-decimal string, never a float."""
    return None if v is None else f"{q2(v):.2f}"


def now() -> datetime:
    return datetime.now(timezone.utc)


def today() -> date:
    return datetime.now(settings.tz).date()


def day_start(d: date) -> datetime:
    return datetime.combine(d, time.min, tzinfo=settings.tz)


def bounds(d_from: date, d_to: date) -> tuple[datetime, datetime]:
    """Inclusive local dates -> [start, end) timestamps for timestamptz columns."""
    return day_start(d_from), day_start(d_to + timedelta(days=1))


def local_date(dt: datetime) -> date:
    return dt.astimezone(settings.tz).date()


def add_months_clamped(base: date, months: int) -> date:
    """Mirror of src/lib/schedule.ts: same day-of-month as base, clamped to month end (Jan 31 -> Feb 28 -> Mar 31)."""
    y, m = divmod(base.month - 1 + months, 12)
    year, month = base.year + y, m + 1
    return date(year, month, min(base.day, calendar.monthrange(year, month)[1]))


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
         "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def amount_in_words(v) -> str:
    """Indian numbering for rupees and paise on newly issued documents."""
    def two(x):
        return _ONES[x] if x < 20 else _TENS[x // 10] + (" " + _ONES[x % 10] if x % 10 else "")

    def three(x):
        return " ".join(p for p in [f"{_ONES[x // 100]} Hundred" if x // 100 else "", two(x % 100) if x % 100 else ""] if p)

    n, paise = divmod(int(q2(v) * 100), 100)
    if n == 0 and paise == 0:
        return "Zero Rupees Only"
    parts = [f"{three(n // 10**7)} Crore" if n // 10**7 else "", f"{two(n % 10**7 // 10**5)} Lakh" if n % 10**7 // 10**5 else "",
             f"{two(n % 10**5 // 1000)} Thousand" if n % 10**5 // 1000 else "", three(n % 1000) if n % 1000 else ""]
    rupees = " ".join(p for p in parts if p) or "Zero"
    return f"Rupees {rupees}" + (f" and {two(paise)} Paise" if paise else "") + " Only"


def jsonable(v):
    if isinstance(v, Decimal):
        return money(v)
    if isinstance(v, (date, time, datetime)):
        return v.isoformat()
    return v


def apply_changes(obj, changes: dict) -> tuple[dict, dict]:
    """Set changed attributes; return (before, after) of what actually changed, for the audit log."""
    before, after = {}, {}
    for k, v in changes.items():
        old = getattr(obj, k)
        if old != v:
            before[k], after[k] = jsonable(old), jsonable(v)
            setattr(obj, k, v)
    return before, after


def like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


# ----------------------------------------------------------------- pagination


@dataclass
class Paging:
    page: int
    page_size: int


def paging(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)) -> Paging:
    return Paging(page, page_size)


def paginate(db: Session, stmt, p: Paging, fn, scalars: bool = True, prefetch=None, *, total_rows: int | None = None, **extra) -> dict:
    """prefetch(rows), if given, loads whatever fn needs for the whole page in a few batched queries (avoids N+1)."""
    total = total_rows
    if total is None:
        total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    res = db.execute(stmt.limit(p.page_size).offset((p.page - 1) * p.page_size))
    rows = res.scalars().all() if scalars else res.all()
    if prefetch and rows:
        prefetch(rows)
    return {"items": [fn(r) for r in rows], "page": p.page, "page_size": p.page_size, "total": total,
            "pages": -(-total // p.page_size), **extra}


def one_trip(db: Session, *stmts) -> tuple:
    """Run several single-value SELECTs (counts, sums) in ONE database round trip (performance).

    Same values as calling db.scalar() on each statement in turn: each one becomes a scalar subquery of a single
    SELECT. Only for statements that return one row (aggregates such as count/sum).
    """
    return tuple(db.execute(select(*(s.scalar_subquery() for s in stmts))).one())


def user_names(db: Session, ids) -> dict[int, str]:
    from .models import User
    ids = {i for i in ids if i}
    return dict(db.execute(select(User.id, User.full_name).where(User.id.in_(ids))).all()) if ids else {}


def user_ref(names: dict[int, str], uid: int | None) -> dict | None:
    return {"id": uid, "name": names.get(uid, "Unknown")} if uid else None


# ----------------------------------------------------------------- audit

request_ctx: ContextVar[tuple[str | None, str | None]] = ContextVar("request_ctx", default=(None, None))

_CATEGORY_RULES = [("Deleted", r"DELETED|REVERSED|CANCELLED|ARCHIVED"), ("Security", r"LOGIN|LOGOUT|PERMISSION|PASSWORD|BACKUP|STAFF|AADHAAR|SESSION"),
                   ("Money", r"PAYMENT|BILL|EXPENSE|RECEIPT")]


def audit(db: Session, actor_id: int | None, action: str, entity_type: str, entity_id: str | None, summary: str,
          before: dict | None = None, after: dict | None = None, reason: str | None = None) -> None:
    db.add(AuditLog(**audit_values(actor_id, action, entity_type, entity_id, summary, before, after, reason)))


def audit_values(actor_id: int | None, action: str, entity_type: str, entity_id: str | None, summary: str,
                 before: dict | None = None, after: dict | None = None, reason: str | None = None) -> dict:
    category = next((c for c, rx in _CATEGORY_RULES if re.search(rx, action)), "Business")
    ip, ua = request_ctx.get()
    return dict(actor_id=actor_id, category=category, action=action, entity_type=entity_type, entity_id=entity_id,
                summary=summary, before_data=before, after_data=after, reason=reason, ip_address=ip, user_agent=ua)


# ----------------------------------------------------------------- numbering

# kind -> (default prefix, yearly?, width). Formats approved in the DB handoff:
# UC-2026-0001, EQ-2026-0001, RCP-2026-01201, SB-2026-0301, CU-0001, SJ-1040, EX-0001.
SEQUENCES = {
    "STUDENT": ("UC", True, 4), "ENQUIRY": ("EQ", True, 4), "RECEIPT": ("RCP", True, 5), "BILL": ("SB", True, 4),
    "CUSTOMER": ("CU", False, 4), "JOB": ("SJ", False, 4), "EXPENSE": ("EX", False, 4),
}


def institute(db: Session) -> InstituteSettings:
    row = db.get(InstituteSettings, 1)
    if row is None:  # the DB lead seeds this row; fall back to defaults if missing
        row = InstituteSettings(id=1, fee_receipt_prefix="RCP", service_bill_prefix="SB")
    return row


def next_code(db: Session, kind: str) -> str:
    """Reserve the current number in the caller's transaction, starting missing sequences at 1."""
    prefix, yearly, width = SEQUENCES[kind]
    period = str(today().year) if yearly else "GLOBAL"
    stmt = insert(NumberSequence).values(entity_type=kind, period_key=period, next_value=2, prefix=prefix, width=width)
    n, prefix, width = db.execute(stmt.on_conflict_do_update(
        index_elements=[NumberSequence.entity_type, NumberSequence.period_key],
        set_={"next_value": NumberSequence.next_value + 1},
    ).returning(NumberSequence.next_value - 1, NumberSequence.prefix, NumberSequence.width)).one()
    if kind == "RECEIPT":
        prefix = institute(db).fee_receipt_prefix
    elif kind == "BILL":
        prefix = institute(db).service_bill_prefix
    return f"{prefix}-{period}-{n:0{width}d}" if yearly else f"{prefix}-{n:0{width}d}"


# ----------------------------------------------------------------- Aadhaar (keys agreed with the security developer)


def _key(name: str) -> str:
    key = getattr(settings, name)
    if not key:
        raise AppError(503, "AADHAAR_KEY_MISSING", "Aadhaar storage is not configured on the server.")
    return key


def aadhaar_hash(digits: str) -> str:
    return hmac.new(_key("aadhaar_hash_key").encode(), digits.encode(), hashlib.sha256).hexdigest()


def aadhaar_columns(digits: str | None) -> dict:
    if not digits:
        return {"aadhaar_ciphertext": None, "aadhaar_lookup_hash": None, "aadhaar_last4": None}
    return {"aadhaar_ciphertext": Fernet(_key("aadhaar_enc_key")).encrypt(digits.encode()),
            "aadhaar_lookup_hash": aadhaar_hash(digits), "aadhaar_last4": digits[-4:]}


def aadhaar_decrypt(ciphertext: bytes) -> str:
    try:
        return Fernet(_key("aadhaar_enc_key")).decrypt(bytes(ciphertext)).decode()
    except InvalidToken:
        raise AppError(500, "AADHAAR_DECRYPT_FAILED", "Stored Aadhaar could not be read with the configured key.")


def aadhaar_mask(last4: str | None) -> str | None:
    return f"XXXX XXXX {last4}" if last4 else None
