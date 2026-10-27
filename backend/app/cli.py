"""Bootstrap commands. Idempotent; inserts only what is missing.

  python -m app.cli seed                      # permission catalog + initial expense categories
  python -m app.cli create-admin USER "Name"  # the single Admin account (password prompted, never echoed)
"""
import getpass
import sys

from sqlalchemy import func, select

from .db import SessionLocal
from .models import ExpenseCategory, InstituteSettings, User
from .routers.admin import ensure_permission_catalog
from .security import MIN_PASSWORD_LENGTH, hash_password, password_problem

EXPENSE_CATEGORIES = ["Rent", "Salary", "Electricity", "Internet & Phone", "Stationery", "Printer & Toner", "Maintenance", "Marketing",
                      "Refreshments", "Miscellaneous", "Other"]


# Institute identity from the receipt / bill paper templates; editable later in Settings.
INSTITUTE_DEFAULTS = {
    "name": "Updaate Computers", "tagline": "Computer Education & Digital Services", "receipt_heading": "Fee Receipt",
    "address": "Near Mhasoba Mandir, Mhasoba Chowk, Dattawadi Pune - 30", "phone": "7888280807 / 8690328080",
    "receipt_footer": "Fees once paid are non-refundable and non-transferable. Please keep this receipt for your records.",
    "service_bill_footer": "Government fees, if any, are charged at actuals. GST not applicable on these services.",
    "service_bill_account_note": "Login ID: provided separately. Password: use the secure setup or reset process; it is never printed.",
}


def seed(db) -> None:
    ensure_permission_catalog(db)
    have = {n.lower() for n in db.scalars(select(ExpenseCategory.name))}
    for name in EXPENSE_CATEGORIES:
        if name.lower() not in have:
            db.add(ExpenseCategory(name=name, is_active=True))
    s = db.get(InstituteSettings, 1) or InstituteSettings(id=1, fee_receipt_prefix="RCP", service_bill_prefix="SB")
    for k, v in INSTITUTE_DEFAULTS.items():
        if not getattr(s, k):
            setattr(s, k, v)
    db.merge(s)
    db.commit()


def create_admin(db, username: str, full_name: str, password: str) -> User:
    if db.scalar(select(func.count()).where(User.role == "ADMIN")):
        raise SystemExit("An Admin account already exists (limit is 1).")
    u = User(username=username.lower(), full_name=full_name, role="ADMIN", password_hash=hash_password(password), is_active=True, designation="Director")
    db.add(u)
    db.commit()
    return u


def main(argv: list[str]) -> None:
    with SessionLocal() as db:
        if argv[:1] == ["seed"]:
            seed(db)
            print("Seed complete.")
        elif argv[:1] == ["create-admin"] and len(argv) == 3:
            pw = getpass.getpass(f"Admin password (min {MIN_PASSWORD_LENGTH} chars): ")
            if problem := password_problem(pw, argv[1]):
                raise SystemExit(problem)
            if pw != getpass.getpass("Repeat password: "):
                raise SystemExit("Passwords must match.")
            print("Created Admin", create_admin(db, argv[1], argv[2], pw).username)
        else:
            print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
