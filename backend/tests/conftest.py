"""Tests run against a throwaway local PostgreSQL (pgserver), never the shared Supabase database.

The schema is built from app.models plus the account-limit trigger copied from the live DB.
"""
import os
import tempfile

import logging

import pgserver
from cryptography.fernet import Fernet

logging.getLogger("pgserver").setLevel(logging.WARNING)
_srv = pgserver.get_server(tempfile.mkdtemp(prefix="ims-pg-"), cleanup_mode="delete")
os.environ["DATABASE_URL"] = _srv.get_uri().replace("postgresql://", "postgresql+psycopg://", 1)
os.environ["AADHAAR_ENC_KEY"] = Fernet.generate_key().decode()
os.environ["AADHAAR_HASH_KEY"] = "test-hash-key"
os.environ["FILE_STORAGE_ROOT"] = tempfile.mkdtemp(prefix="ims-files-")

import itertools  # noqa: E402
from datetime import date, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app import cli  # noqa: E402
from app.common import today  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, User, UserPermission  # noqa: E402
from app.routers.admin import ensure_permission_catalog  # noqa: E402
from app.security import hash_password  # noqa: E402

TRIGGER = """
CREATE OR REPLACE FUNCTION public.ims_enforce_user_account_limit() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE n integer; lim integer;
BEGIN
  PERFORM 1 FROM public.account_limits WHERE id=1 FOR UPDATE;
  IF NEW.role='ADMIN' THEN SELECT max_admin INTO lim FROM public.account_limits WHERE id=1;
  ELSE SELECT max_staff INTO lim FROM public.account_limits WHERE id=1; END IF;
  SELECT count(*) INTO n FROM public.users WHERE role=NEW.role AND deleted_at IS NULL AND id IS DISTINCT FROM NEW.id;
  IF n>=lim THEN RAISE EXCEPTION 'IMS_ACCOUNT_LIMIT_REACHED role=% maximum=%',NEW.role,lim USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER ims_account_cap_before_insert BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION ims_enforce_user_account_limit();
CREATE TRIGGER ims_account_cap_before_role_update BEFORE UPDATE OF role ON public.users FOR EACH ROW
  WHEN (((old.role)::text IS DISTINCT FROM (new.role)::text)) EXECUTE FUNCTION ims_enforce_user_account_limit();
"""

Base.metadata.create_all(engine)
with engine.begin() as c:
    c.execute(text(TRIGGER))

TABLES = ", ".join(t.name for t in Base.metadata.sorted_tables)
PASSWORD = "secret-pass-1"


@pytest.fixture(autouse=True)
def fresh_db():
    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
        c.execute(text("INSERT INTO account_limits (id) VALUES (1)"))
        c.execute(text("INSERT INTO institute_settings (id, name, address, phone) VALUES (1, 'Updaate Computers', 'Main Road', '+91 90000 00000')"))
    with SessionLocal() as db:
        cli.seed(db)
        db.add(User(username="admin", full_name="Rakesh Verma", role="ADMIN", password_hash=hash_password(PASSWORD), is_active=True))
        db.commit()
    yield


class Api:
    """TestClient wrapper that prefixes /api/v1 and sends the bearer token."""

    def __init__(self, client: TestClient, token: str | None = None):
        self.c, self.token = client, token

    def __getattr__(self, method):
        def call(path, **kw):
            headers = kw.pop("headers", {})
            if self.token:
                headers["Authorization"] = f"Bearer {self.token}"
            return self.c.request(method.upper(), "/api/v1" + path, headers=headers, **kw)
        return call


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def login(client, username, password=PASSWORD) -> Api:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return Api(client, r.json()["token"])


@pytest.fixture
def admin(client) -> Api:
    return login(client, "admin")


_seq = itertools.count(1)


@pytest.fixture
def make_staff(client):
    def make(perms=(), username=None) -> Api:
        username = username or f"staff{next(_seq)}"
        with SessionLocal() as db:
            u = User(username=username, full_name=username.title(), role="STAFF", password_hash=hash_password(PASSWORD), is_active=True)
            db.add(u)
            db.flush()
            ids = ensure_permission_catalog(db)
            for p in perms:
                db.add(UserPermission(user_id=u.id, permission_id=ids[p]))
            db.commit()
        return login(client, username)
    return make


# ----------------------------------------------------------------- data builders


def ok(r, status=200):
    assert r.status_code == status, f"{r.status_code}: {r.text}"
    return r.json()


@pytest.fixture
def course(admin):
    c = ok(admin.post("/courses", json={"code": "dca", "name": "Diploma in Computer Applications", "duration_months": 6, "fee": "7500"}), 201)
    slot = ok(admin.post("/time-slots", json={"course_id": c["id"], "name": "DCA Morning A", "start_time": "08:00", "end_time": "09:30",
                                              "days": "Mon - Sat", "faculty": "Neha Gupta", "capacity": 2}), 201)
    return c | {"slot": slot}


def admission_body(course, **over):
    body = {"full_name": "Aarav Sharma", "guardian_name": "Ramesh Sharma", "dob": "2005-04-10", "gender": "Male", "mobile": "9876543210",
            "address": "12 Civil Lines", "course_id": course["id"], "time_slot_id": course["slot"]["id"], "discount": "0", "paid_now": "500",
            "payment_mode": "Cash", "installment_count": 8, "first_due_date": (today() + timedelta(days=30)).isoformat()}
    return body | over


@pytest.fixture
def enquiry(admin, course):
    return ok(admin.post("/enquiries", json={"student_name": "Aarav Sharma", "mobile": "98765 43210", "course_id": course["id"]}), 201)


@pytest.fixture
def student(admin, course, enquiry):
    return ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course)), 201)


@pytest.fixture
def catalog(admin):
    cat = ok(admin.post("/service-categories", json={"name": "Identity Documents"}), 201)
    pan = ok(admin.post("/services", json={"name": "PAN Card - New", "category_id": cat["id"], "price": "250"}), 201)
    prn = ok(admin.post("/services", json={"name": "B/W Print (per page)", "category_id": cat["id"], "price": "3"}), 201)
    cust = ok(admin.post("/customers", json={"full_name": "Sunita Devi", "mobile": "9811022334"}), 201)
    return {"cat": cat, "pan": pan, "print": prn, "customer": cust}


@pytest.fixture
def job(admin, catalog):
    return ok(admin.post("/service-jobs", json={"customer_code": catalog["customer"]["code"], "service_ids": [catalog["pan"]["id"]],
                                                "due_date": (today() + timedelta(days=7)).isoformat()}), 201)


YEAR = date.today().year
