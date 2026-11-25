"""Action points 4, 5, 15: authentication seam, RBAC, 1 Admin + 4 Staff limit (incl. concurrency)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from psycopg import OperationalError as PsycopgOperationalError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.common import now
from app.config import settings
from app.db import SessionLocal
from app.models import User, UserSession
from app.security import hash_password, token_hash
from conftest import PASSWORD, Api, login, ok


def new_staff(admin, name):
    return admin.post("/staff", json={"full_name": name.title(), "username": name, "designation": "Front Desk"})


def test_login_pooler_password_failure_returns_safe_503(client, monkeypatch, caplog):
    def cannot_connect(self, *args, **kwargs):
        cause = PsycopgOperationalError("FATAL: password authentication failed for user \"postgres\" test-dsn-secret")
        raise OperationalError(None, None, cause) from cause

    monkeypatch.setattr(Session, "scalars", cannot_connect)
    origin = settings.origins[0]
    response = client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD},
                           headers={"Origin": origin})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"
    assert response.headers["Access-Control-Allow-Origin"] == origin
    assert response.headers["X-Request-ID"] in caplog.text
    assert "database password authentication failed" in caplog.text
    assert "in login" in caplog.text
    assert "test-dsn-secret" not in caplog.text + response.text
    assert PASSWORD not in caplog.text + response.text


def test_unauthenticated_and_forbidden(client, make_staff):
    assert Api(client).get("/students").status_code == 401
    assert Api(client, "bogus-token").get("/students").json()["error"]["code"] == "SESSION_INVALID"
    staff = make_staff(["students.view"])
    assert staff.get("/students").status_code == 200
    assert staff.get("/fees/payments").status_code == 403
    assert staff.get("/staff").status_code == 403  # admin-only even if requested
    assert staff.get("/reports").status_code == 403


def test_login_lockout_logout(client, admin):
    for _ in range(5):
        assert client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD})
    assert r.status_code == 429 and r.json()["error"]["code"] == "LOGIN_LOCKED"
    assert admin.get("/auth/me").json()["role"] == "Admin"  # existing session unaffected
    assert admin.post("/auth/logout").status_code == 204
    assert admin.get("/auth/me").status_code == 401


def test_absolute_expiry_rejects_recently_active_session(admin):
    with SessionLocal() as db:
        session = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(admin.token)))
        session.expires_at = now() - timedelta(seconds=1)
        session.last_activity_at = now()
        db.commit()

    response = admin.get("/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_INVALID"


def test_change_password_idle_timeout_and_security_headers(client, admin):
    r = admin.post("/auth/change-password", json={"current_password": "wrong-one", "new_password": "brand-new-pass"})
    assert r.json()["error"]["code"] == "INVALID_CURRENT_PASSWORD"
    assert admin.post("/auth/change-password", json={"current_password": PASSWORD, "new_password": "short"}).status_code == 422
    other = login(client, "admin")
    assert admin.post("/auth/change-password", json={"current_password": PASSWORD, "new_password": "brand-new-pass"}).status_code == 204
    assert other.get("/auth/me").status_code == 401 and admin.get("/auth/me").status_code == 200  # other devices signed out
    login(client, "admin", "brand-new-pass")
    with SessionLocal() as db:  # simulate 31 idle minutes
        for s in db.query(UserSession):
            s.last_activity_at = now() - timedelta(minutes=31)
        db.commit()
    r = admin.get("/auth/me")
    assert r.json()["error"]["code"] == "SESSION_EXPIRED"
    h = client.get("/api/v1/health").headers
    assert h["X-Content-Type-Options"] == "nosniff" and h["Cache-Control"] == "no-store" and "X-Request-ID" in h


def test_ip_throttle(client):
    for i in range(20):
        client.post("/api/v1/auth/login", json={"username": f"nobody{i}", "password": "x"})
    # 23 Nov (SEC-03): names that already failed from this address are stopped ...
    assert client.post("/api/v1/auth/login", json={"username": "nobody3", "password": "x"}).json()["error"]["code"] == "TOO_MANY_ATTEMPTS"
    # ... but 20 wrong tries on other names no longer keep the Admin out.
    assert client.post("/api/v1/auth/login", json={"username": "admin", "password": PASSWORD}).status_code == 200


def test_staff_limit_is_four_and_deactivation_keeps_the_slot(admin, client):
    created = [ok(new_staff(admin, f"staff{i}"), 201) for i in range(4)]
    assert created[0]["temporary_password"] and created[-1]["account_limit"] == {"admin_accounts": 1, "staff_used": 4, "staff_limit": 4, "staff_remaining": 0}
    r = new_staff(admin, "staff5")
    assert r.status_code == 409 and r.json()["error"] == {"code": "STAFF_ACCOUNT_LIMIT_REACHED",
                                                          "message": "A maximum of 4 Staff accounts is allowed for this institute.", "field_errors": {}}
    ok(admin.post(f"/staff/{created[0]['staff']['id']}/deactivate"))
    assert new_staff(admin, "staff6").status_code == 409  # disabled staff still occupies a slot
    # the new staff can sign in with the one-time password, and a disabled one can't
    login(client, "staff1", created[1]["temporary_password"])
    assert client.post("/api/v1/auth/login", json={"username": "staff0", "password": created[0]["temporary_password"]}).status_code == 401


def test_second_admin_is_rejected_by_the_database():
    with SessionLocal() as db:
        db.add(User(username="admin2", full_name="Second", role="ADMIN", password_hash=hash_password(PASSWORD)))
        try:
            db.commit()
            raise AssertionError("second admin was created")
        except IntegrityError as e:
            assert "IMS_ACCOUNT_LIMIT_REACHED" in str(e.orig)


def test_concurrent_staff_creation_cannot_exceed_limit(admin):
    for i in range(3):
        ok(new_staff(admin, f"base{i}"), 201)

    def create(i):
        with SessionLocal() as db:
            db.add(User(username=f"race{i}", full_name=f"Race {i}", role="STAFF", password_hash="x"))
            try:
                db.commit()
                return True
            except IntegrityError:
                return False

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(create, range(6)))
    assert results.count(True) == 1
    assert ok(admin.get("/staff"))["account_limit"]["staff_used"] == 4


def test_permissions_are_per_user_and_admin_only_cannot_be_delegated(admin, client):
    s = ok(new_staff(admin, "neha.g"), 201)
    uid = s["staff"]["id"]
    assert admin.put(f"/staff/{uid}/permissions", json={"codes": ["payments.delete_or_reverse"]}).json()["error"]["code"] == "ADMIN_ONLY_PERMISSION"
    assert admin.put(f"/staff/{uid}/permissions", json={"codes": ["nope"]}).json()["error"]["code"] == "UNKNOWN_PERMISSION"
    ok(admin.put(f"/staff/{uid}/permissions", json={"codes": ["students.view", "fees.view"]}))
    staff = login(client, "neha.g", s["temporary_password"])
    assert staff.get("/students").json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"  # 23 Nov (SEC-05)
    assert staff.post("/auth/change-password", json={"current_password": s["temporary_password"], "new_password": "neha-own-pass-77"}).status_code == 204
    assert set(ok(staff.get("/auth/me"))["permissions"]) == {"students.view", "fees.view"}
    assert staff.get("/students").status_code == 200 and staff.get("/expenses").status_code == 403
    ok(admin.put(f"/staff/{uid}/permissions", json={"codes": []}))
    assert staff.get("/students").status_code == 403  # applied on the next request
    change = ok(admin.get("/audit", params={"action": "PERMISSION_CHANGED"}))["items"][0]
    assert change["before"] == {"fees.view": "Allowed", "students.view": "Allowed"}
    ok(admin.post(f"/staff/{uid}/deactivate"))
    assert staff.get("/auth/me").status_code == 401  # sessions revoked on deactivation
