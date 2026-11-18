"""13 Nov QA: once 4 Staff accounts existed, the institute could never add anyone again (no remove option, and the
cap counted every row ever created). "Remove account" closes an account for good and frees its slot; disabled
accounts still take a slot (approved rule)."""
from app.db import SessionLocal
from app.models import User
from app.security import hash_password
from conftest import PASSWORD, login, ok


def staff_body(username):
    return {"full_name": username.title(), "username": username, "designation": "Front Desk"}


def fill_four(admin):
    return [ok(admin.post("/staff", json=staff_body(f"member{i}")), 201)["staff"]["id"] for i in range(1, 5)]


def test_disabled_still_takes_a_slot_removed_frees_it(client, admin):
    ids = fill_four(admin)
    ok(admin.post(f"/staff/{ids[0]}/deactivate"))
    full = admin.post("/staff", json=staff_body("newcomer"))
    assert full.status_code == 409 and full.json()["error"]["code"] == "STAFF_ACCOUNT_LIMIT_REACHED"  # approved rule kept

    out = ok(admin.post(f"/staff/{ids[0]}/remove"))
    assert out["removed"]["username"] == "member1"
    assert out["account_limit"] == {"admin_accounts": 1, "staff_used": 3, "staff_limit": 4, "staff_remaining": 1}
    listed = ok(admin.get("/staff"))
    assert [s["username"] for s in listed["items"] if s["role"] == "Staff"] == ["member2", "member3", "member4"]

    ok(admin.post("/staff", json=staff_body("newcomer")), 201)  # the DB trigger agrees: the slot is free
    again = admin.post("/staff", json=staff_body("onemore"))
    assert again.json()["error"]["code"] == "STAFF_ACCOUNT_LIMIT_REACHED"  # still capped at 4


def test_removed_person_is_signed_out_and_cannot_sign_in(client, admin):
    ids = fill_four(admin)
    with SessionLocal() as db:  # give member2 a known password
        db.get(User, ids[1]).password_hash = hash_password(PASSWORD)
        db.commit()
    member = login(client, "member2")
    assert member.get("/auth/me").status_code == 200
    ok(admin.post(f"/staff/{ids[1]}/remove"))
    assert member.get("/auth/me").status_code == 401  # existing session ended
    r = client.post("/api/v1/auth/login", json={"username": "member2", "password": PASSWORD})
    assert r.status_code == 401
    assert admin.get(f"/staff/{ids[1]}").status_code == 404
    assert admin.post(f"/staff/{ids[1]}/activate").status_code == 404  # can't be brought back
    assert all(s["id"] != ids[1] for s in ok(admin.get("/directory/staff")))  # gone from pickers
    taken = admin.post("/staff", json=staff_body("member2"))
    assert taken.json()["error"]["code"] == "USERNAME_TAKEN"  # username stays reserved


def test_history_keeps_the_name_and_the_removal_is_audited(admin):
    ids = fill_four(admin)
    ok(admin.post(f"/staff/{ids[2]}/remove"))
    log = ok(admin.get("/audit", params={"q": "member3"}))
    actions = [e["action"] for e in log["items"]]
    assert "STAFF_REMOVED" in actions and "STAFF_CREATED" in actions


def test_admin_cannot_be_removed_and_staff_cannot_remove(client, admin, make_staff):
    me = ok(admin.get("/auth/me"))
    r = admin.post(f"/staff/{me['id']}/remove")
    assert r.status_code == 400 and r.json()["error"]["code"] == "CANNOT_CHANGE_ADMIN"
    staff = make_staff(["students.view"])
    other = ok(admin.post("/staff", json=staff_body("target")), 201)["staff"]["id"]
    assert staff.post(f"/staff/{other}/remove").status_code == 403
