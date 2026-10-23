"""Bootstrap commands. Idempotent; inserts only what is missing.

  python -m app.cli seed                      # permission catalog + initial expense categories
  python -m app.cli create-admin USER "Name"  # the single Admin account (password prompted, never echoed)
"""
import getpass
import sys

from sqlalchemy import func, select

from .db import SessionLocal
from .models import ExpenseCategory, User
from .routers.admin import ensure_permission_catalog
from .security import hash_password

EXPENSE_CATEGORIES = ["Rent", "Salary", "Electricity", "Internet & Phone", "Stationery", "Printer & Toner", "Maintenance", "Marketing",
                      "Refreshments", "Miscellaneous", "Other"]


def seed(db) -> None:
    ensure_permission_catalog(db)
    have = {n.lower() for n in db.scalars(select(ExpenseCategory.name))}
    for name in EXPENSE_CATEGORIES:
        if name.lower() not in have:
            db.add(ExpenseCategory(name=name, is_active=True))
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
            pw = getpass.getpass("Admin password (min 8 chars): ")
            if len(pw) < 8 or pw != getpass.getpass("Repeat password: "):
                raise SystemExit("Passwords must match and be at least 8 characters.")
            print("Created Admin", create_admin(db, argv[1], argv[2], pw).username)
        else:
            print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
