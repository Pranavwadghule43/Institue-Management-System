"""23 Nov 2026 security patches (IMS Security Review): SEC-03 growing wait, SEC-05 forced change of temporary passwords,
forgotten Admin password (recovery key), SEC-06 encrypted documents, SEC-08 production start checks, SEC-11 request
limits, SEC-12 stronger password hashing. (Two-step sign-in was dropped on 23 Nov: password-only sign-in.)"""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.common import now
from app.config import Settings, production_problems, settings
from app.db import SessionLocal
from app.models import AuditLog, User
from app.security import hash_password, reset_password_console, wait_seconds
from conftest import PASSWORD, login, ok

LOGIN = "/api/v1/auth/login"


def attempt(client, username="admin", password=PASSWORD):
    return client.post(LOGIN, json={"username": username, "password": password})


def expire_wait(username="admin"):
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.username == username))
        u.locked_until = now() - timedelta(seconds=1)
        db.commit()


# ----------------------------------------------------------------- SEC-03 growing wait instead of a hard lock


def test_wait_grows_and_is_capped():
    assert [wait_seconds(n) for n in (5, 6, 7, 8, 9, 10, 11, 30)] == [30, 60, 120, 240, 480, 900, 900, 900]


def test_wait_after_five_wrong_passwords_then_longer_after_more(client):
    for _ in range(5):
        assert attempt(client, password="wrong").status_code == 401
    r = attempt(client)
    assert r.status_code == 429 and r.json()["error"]["code"] == "LOGIN_LOCKED"
    assert 1 <= int(r.headers["Retry-After"]) <= 30 and "seconds" in r.json()["error"]["message"]
    # During the wait nothing is checked: right and wrong passwords get the same answer.
    assert attempt(client, password="wrong").json()["error"]["code"] == "LOGIN_LOCKED"
    expire_wait()
    r = attempt(client, password="wrong-again")  # 6th wrong password: the next wait is 1 minute
    assert r.status_code == 401
    r = attempt(client)
    assert r.status_code == 429 and 31 <= int(r.headers["Retry-After"]) <= 60
    expire_wait()
    assert attempt(client).status_code == 200  # after the wait the right password works and the count is reset
    with SessionLocal() as db:
        u = db.scalar(select(User).where(User.username == "admin"))
        assert u.failed_attempts == 0 and u.locked_until is None


def test_password_only_sign_in_and_others_failures_dont_block_the_admin(client):
    r = attempt(client)
    assert r.status_code == 200 and "two_step" not in r.json()["user"]
    for i in range(20):
        attempt(client, username=f"nobody{i}", password="x")  # someone else on the same network
    assert attempt(client, username="nobody3", password="x").json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
    assert attempt(client).status_code == 200  # the Admin had no failures from this address
    assert client.post(LOGIN, json={"username": "admin", "password": PASSWORD, "code": "123456"}).status_code == 422  # no code field any more


# ----------------------------------------------------------------- forgotten passwords


RECOVER = "/api/v1/auth/recover"


def test_admin_recovery_key_resets_a_forgotten_password_once(client, admin):
    assert admin.post("/auth/recovery-key", json={"current_password": "wrong"}).json()["error"]["code"] == "INVALID_CURRENT_PASSWORD"
    assert ok(admin.get("/auth/me"))["recovery_key_set"] is False
    key = ok(admin.post("/auth/recovery-key", json={"current_password": PASSWORD}))["recovery_key"]
    assert len(key) == 29 and key.count("-") == 4 and ok(admin.get("/auth/me"))["recovery_key_set"] is True
    with SessionLocal() as db:
        stored = db.scalar(select(User.recovery_key_hash).where(User.username == "admin"))
    assert stored.startswith("scrypt$") and key.replace("-", "") not in stored
    other = login(client, "admin")
    weak = client.post(RECOVER, json={"username": "admin", "recovery_key": key, "new_password": "password123"})
    assert weak.json()["error"]["code"] == "PASSWORD_TOO_WEAK"  # key not used up by a refused password
    r = client.post(RECOVER, json={"username": "admin", "recovery_key": key.lower().replace("-", " "), "new_password": "Brand-new-chief-77"})
    assert r.status_code == 200 and r.json()["recovery_key"] != key  # the next key comes back at once
    assert other.get("/auth/me").status_code == 401 and admin.get("/auth/me").status_code == 401  # every session ended
    assert attempt(client).status_code == 401 and attempt(client, password="Brand-new-chief-77").status_code == 200
    again = client.post(RECOVER, json={"username": "admin", "recovery_key": key, "new_password": "Another-chief-pass-88"})
    assert again.json()["error"]["code"] == "RECOVERY_FAILED"  # one use only
    with SessionLocal() as db:
        actions = {a for (a,) in db.execute(select(AuditLog.action))}
    assert {"RECOVERY_KEY_CREATED", "PASSWORD_RECOVERED"} <= actions


def test_recovery_key_works_during_a_wait_and_wrong_keys_count(client, admin):
    key = ok(admin.post("/auth/recovery-key", json={"current_password": PASSWORD}))["recovery_key"]
    old = ok(admin.post("/auth/recovery-key", json={"current_password": PASSWORD}))["recovery_key"]
    assert old != key  # a new key replaces the old one
    for _ in range(6):
        attempt(client, password="attacker-guess")
    assert attempt(client).json()["error"]["code"] == "LOGIN_LOCKED"  # someone guessing made the Admin wait
    bad = client.post(RECOVER, json={"username": "admin", "recovery_key": key, "new_password": "Brand-new-chief-77"})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "RECOVERY_FAILED"
    assert client.post(RECOVER, json={"username": "admin", "recovery_key": old, "new_password": "Brand-new-chief-77"}).status_code == 200
    assert attempt(client, password="Brand-new-chief-77").status_code == 200  # wait cleared


def test_staff_get_their_own_key_and_can_reset_a_forgotten_password(client, admin):
    created = ok(admin.post("/staff", json={"username": "ravi.k", "full_name": "Ravi K", "mobile": "9876500001"}), 201)
    staff = login(client, "ravi.k", created["temporary_password"])
    assert ok(staff.get("/auth/me"))["recovery_key_reminder"] is True
    assert staff.post("/auth/change-password", json={"current_password": created["temporary_password"], "new_password": "Ravi-own-pass-42"}).status_code == 204
    key = ok(staff.post("/auth/recovery-key", json={"current_password": "Ravi-own-pass-42"}))["recovery_key"]  # first sign-in step
    me = ok(staff.get("/auth/me"))
    assert me["recovery_key_set"] is True and me["recovery_key_reminder"] is False
    assert ok(client.post(LOGIN, json={"username": "ravi.k", "password": "Ravi-own-pass-42"}))["user"]["recovery_key_reminder"] is False
    r = client.post(RECOVER, json={"username": "ravi.k", "recovery_key": key, "new_password": "Ravi-new-pass-43"})
    assert r.status_code == 200 and r.json()["recovery_key"]
    assert attempt(client, username="ravi.k", password="Ravi-new-pass-43").status_code == 200
    # Admin reset: the old key stops working and a new one is shown at the next sign-in.
    temp = ok(admin.post(f"/staff/{created['staff']['id']}/reset-password"))["temporary_password"]
    assert client.post(RECOVER, json={"username": "ravi.k", "recovery_key": r.json()["recovery_key"], "new_password": "Ravi-new-pass-44"}).json()["error"]["code"] == "RECOVERY_FAILED"
    assert ok(client.post(LOGIN, json={"username": "ravi.k", "password": temp}))["user"]["recovery_key_reminder"] is True


def test_unknown_names_and_accounts_without_a_key_look_the_same(client, admin, make_staff):
    make_staff(["students.view"], username="ravi")
    for name in ("ravi", "nobody-here", "admin"):  # no keys made yet
        r = client.post(RECOVER, json={"username": name, "recovery_key": "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE", "new_password": "Brand-new-pass-77"})
        assert r.status_code == 400 and r.json()["error"] == {"code": "RECOVERY_FAILED", "message": "Username or recovery key is incorrect.", "field_errors": {}}


def test_server_console_reset_is_the_last_resort(client, admin):
    with SessionLocal() as db:
        with pytest.raises(SystemExit):
            reset_password_console(db, "admin", "short")
        reset_password_console(db, "ADMIN", "Console-reset-pass-55")
    assert admin.get("/auth/me").status_code == 401
    assert attempt(client, password="Console-reset-pass-55").status_code == 200


# ----------------------------------------------------------------- SEC-05 temporary passwords must be changed


def test_temporary_password_only_opens_change_password(client, admin):
    created = ok(admin.post("/staff", json={"username": "ravi.k", "full_name": "Ravi K", "mobile": "9876500001"}), 201)
    assert created["staff"]["must_change_password"] is True
    temp = created["temporary_password"]
    staff = login(client, "ravi.k", temp)
    assert ok(staff.get("/auth/me"))["must_change_password"] is True
    r = staff.get("/students")
    assert r.status_code == 403 and r.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert staff.post("/auth/change-password", json={"current_password": temp, "new_password": "ravi-own-pass-42"}).status_code == 204
    assert ok(staff.get("/auth/me"))["must_change_password"] is False
    assert staff.get("/students").status_code == 403 and staff.get("/students").json()["error"]["code"] == "FORBIDDEN"  # normal rules again
    # An Admin reset hands out a new temporary password with the same rule.
    temp2 = ok(admin.post(f"/staff/{created['staff']['id']}/reset-password"))["temporary_password"]
    assert login(client, "ravi.k", temp2).get("/fees/payments").json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"


# ----------------------------------------------------------------- SEC-12 stronger hashing, upgraded at sign-in


def test_old_hashes_still_work_and_are_upgraded(client, monkeypatch):
    with SessionLocal() as db:
        assert db.scalar(select(User.password_hash).where(User.username == "admin")).startswith("scrypt$16384$")
    monkeypatch.setattr(settings, "password_hash_n", 2**15)
    assert attempt(client).status_code == 200
    with SessionLocal() as db:
        stored = db.scalar(select(User.password_hash).where(User.username == "admin"))
    assert stored.startswith("scrypt$32768$8$1$")
    assert attempt(client).status_code == 200  # the upgraded hash verifies
    assert hash_password("x" * 12).startswith("scrypt$32768$")


# ----------------------------------------------------------------- SEC-08 / SEC-13 production start checks


def test_production_refuses_unsafe_settings():
    unsafe = Settings(_env_file=None, app_env="production", database_url="postgresql+psycopg://u:p@db.example.supabase.co:5432/postgres?sslmode=require",
                      frontend_origin="http://localhost:5173", expose_docs=True, data_enc_key=None, password_hash_n=16384)
    problems = " | ".join(production_problems(unsafe))
    for expected in ("DATA_ENC_KEY", "FRONTEND_ORIGIN", "EXPOSE_DOCS", "PASSWORD_HASH_N", "verify-full"):
        assert expected in problems
    safe = Settings(_env_file=None, app_env="production", data_enc_key="k", frontend_origin="https://ims.example.in",
                    password_hash_n=2**17,
                    database_url="postgresql+psycopg://u:p@db.example.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=ca.crt")
    assert production_problems(safe) == []


# ----------------------------------------------------------------- SEC-06 documents encrypted on disk


def test_documents_are_encrypted_on_disk_and_old_plain_files_still_open(admin, job):
    from pathlib import Path

    from app.models import File as FileRow
    code, pdf = job["code"], b"%PDF-1.4 PAN scan (synthetic)"
    doc = ok(admin.post(f"/service-jobs/{code}/documents", files={"file": ("pan.pdf", pdf, "application/pdf")}, data={"document_type": "PAN Card"}), 201)
    with SessionLocal() as db:
        key = db.scalar(select(FileRow.storage_key).order_by(FileRow.id.desc()))
    stored = (Path(settings.file_storage_root) / key).read_bytes()
    assert stored.startswith(b"gAAAAA") and b"PAN scan" not in stored
    r = admin.get(f"/service-jobs/{code}/documents/{doc['id']}")
    assert r.status_code == 200 and r.content == pdf and r.headers["content-disposition"].startswith("attachment;")
    (Path(settings.file_storage_root) / key).write_bytes(pdf)  # a file saved before this change (plain)
    assert admin.get(f"/service-jobs/{code}/documents/{doc['id']}").content == pdf
    (Path(settings.file_storage_root) / key).write_bytes(b"%PDF-1.4 swapped on disk")  # tampered file is refused
    assert admin.get(f"/service-jobs/{code}/documents/{doc['id']}").json()["error"]["code"] == "DOCUMENT_CHANGED"


# ----------------------------------------------------------------- SEC-11 per-user request limits


def test_search_is_rate_limited_per_user(admin, make_staff):
    from app import ratelimit
    codes = [admin.get("/search", params={"q": "ab"}).status_code for _ in range(ratelimit.LIMITS["search"] + 1)]
    assert codes[:-1] == [200] * ratelimit.LIMITS["search"] and codes[-1] == 429
    r = admin.get("/search", params={"q": "ab"})
    assert r.json()["error"]["code"] == "RATE_LIMITED" and 1 <= int(r.headers["Retry-After"]) <= 61
    staff = make_staff(["students.view"])
    assert staff.get("/search", params={"q": "ab"}).status_code == 200  # counted per user
    assert "aadhaar" not in ratelimit.LIMITS  # 25 Nov: the Aadhaar reveal endpoint and its limit are gone
    assert ratelimit.check("search", 999, at=0.0) == 0 and ratelimit.check("search", 999, at=61.0) == 0  # window slides


def test_after_a_recovery_the_admin_is_not_blocked_by_an_attacker_on_the_same_network(client, admin):
    key = ok(admin.post("/auth/recovery-key", json={"current_password": PASSWORD}))["recovery_key"]
    for i in range(20):
        attempt(client, password=f"attacker-{i}")  # same address as the real Admin (shared office / proxy)
    assert attempt(client).json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
    assert client.post("/api/v1/auth/recover", json={"username": "admin", "recovery_key": key, "new_password": "Recovered-chief-2026"}).status_code == 200
    assert attempt(client, password="Recovered-chief-2026").status_code == 200
    assert attempt(client, password="attacker-again").status_code == 401  # a new wrong try counts again ...
    assert attempt(client, password="Recovered-chief-2026").json()["error"]["code"] == "TOO_MANY_ATTEMPTS"  # ... and blocks again


def test_recovery_reminder_only_while_there_is_no_usable_key(client, admin):
    assert ok(admin.get("/auth/me"))["recovery_key_reminder"] is True
    key = ok(admin.post("/auth/recovery-key", json={"current_password": PASSWORD}))["recovery_key"]
    for _ in range(2):  # every later sign-in: no reminder
        assert ok(client.post(LOGIN, json={"username": "admin", "password": PASSWORD}))["user"]["recovery_key_reminder"] is False
    assert client.post("/api/v1/auth/recover", json={"username": "admin", "recovery_key": key, "new_password": "Recovered-chief-2026"}).status_code == 200
    user = ok(client.post(LOGIN, json={"username": "admin", "password": "Recovered-chief-2026"}))["user"]
    assert user["recovery_key_set"] is True and user["recovery_key_reminder"] is False  # the reset handed out the next key


def test_old_aadhaar_key_name_still_works_for_documents():
    """25 Nov: AADHAAR_ENC_KEY was renamed DATA_ENC_KEY; servers that still set the old name keep reading their documents."""
    assert Settings(_env_file=None, database_url="postgresql://x@/x", aadhaar_enc_key="old-name-key").data_enc_key == "old-name-key"
    assert Settings(_env_file=None, database_url="postgresql://x@/x", data_enc_key="new-name-key").data_enc_key == "new-name-key"

