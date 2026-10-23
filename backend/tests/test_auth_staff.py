"""Action points 4, 5, 15: authentication seam, RBAC, 1 Admin + 4 Staff limit (incl. concurrency)."""
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import User
from app.security import hash_password
from conftest import PASSWORD, Api, login, ok


def new_staff(admin, name):
    return admin.post("/staff", json={"full_name": name.title(), "username": name, "designation": "Front Desk"})


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
    assert set(ok(staff.get("/auth/me"))["permissions"]) == {"students.view", "fees.view"}
    assert staff.get("/students").status_code == 200 and staff.get("/expenses").status_code == 403
    ok(admin.put(f"/staff/{uid}/permissions", json={"codes": []}))
    assert staff.get("/students").status_code == 403  # applied on the next request
    change = ok(admin.get("/audit", params={"action": "PERMISSION_CHANGED"}))["items"][0]
    assert change["before"] == {"fees.view": "Allowed", "students.view": "Allowed"}
    ok(admin.post(f"/staff/{uid}/deactivate"))
    assert staff.get("/auth/me").status_code == 401  # sessions revoked on deactivation
