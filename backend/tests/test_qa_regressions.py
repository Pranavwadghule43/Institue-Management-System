"""QA audit regressions (Dhruvank, 27 Oct 2026) - one test per confirmed defect.

Each test describes the CORRECT behaviour and is marked xfail(strict=True) while the defect is open,
so the suite stays green today. When a fix lands the test XPASSes, strict mode turns that into a
failure, and the fixer removes the marker - the test then guards against the bug coming back.
IDs match the QA Audit Report.
"""
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.common import today
from app.main import app
from conftest import PASSWORD, ok


def bug(qa_id: str, why: str):
    return pytest.mark.xfail(strict=True, reason=f"{qa_id}: {why}")


@pytest.fixture
def raw(client):
    """Client that returns 500 responses instead of raising, like a browser sees them."""
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# ----------------------------------------------------------------- QA-01 (Critical) blank email crashes the API


@pytest.mark.parametrize("email", ["", None])
def test_enquiry_with_blank_email_is_created(admin, course, email):
    r = admin.post("/enquiries", json={"student_name": "Blank Email", "mobile": "9876543210", "course_id": course["id"], "email": email})
    assert r.status_code == 201, r.text
    assert r.json()["email"] is None


def test_invalid_email_is_still_rejected(admin, course):
    r = admin.post("/enquiries", json={"student_name": "Bad Email", "mobile": "9876543210", "course_id": course["id"], "email": "not-an-email"})
    assert r.status_code == 422 and "email" in r.json()["error"]["field_errors"]


def test_admission_with_null_email_is_created(admin, course, enquiry):
    from conftest import admission_body
    r = admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course, email=None))
    assert r.status_code == 201, r.text


def test_student_email_can_be_cleared(admin, student):
    r = admin.patch(f"/students/{student['student']['code']}", json={"email": None})
    assert r.status_code == 200, r.text


# ----------------------------------------------------------------- QA-02 (High) cancelling a paid bill rewrites past cash


@bug("QA-02", "revenue queries count status='Paid' only, so cancelling a paid bill removes cash already collected")
def test_cancelling_a_paid_bill_keeps_collected_cash_visible(admin, catalog, job):
    b = ok(admin.post("/service-bills", json={"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}), 201)
    ok(admin.post(f"/service-bills/{b['code']}/pay", json={"payment_mode": "Cash"}))
    before = ok(admin.get("/finance/daily-cash"))
    ok(admin.post(f"/service-bills/{b['code']}/cancel", json={"reason": "Wrong service billed"}))
    after = ok(admin.get("/finance/daily-cash"))
    # Either the original receipt stays in that day's cash, or an explicit refund/adjustment line explains the change.
    assert after["services"] == before["services"] or any(x["kind"] != "Service bill" and b["code"] in (x["ref"] or "") for x in after["ledger"])


# ----------------------------------------------------------------- QA-03 (High) sensitive documents detected by file name


def test_aadhaar_photo_copy_is_sensitive(admin, job, make_staff):
    jpg = b"\xff\xd8\xff\xe0" + b"0" * 50
    d = ok(admin.post(f"/service-jobs/{job['code']}/documents", files={"file": ("aadhaar photo copy.jpg", jpg, "image/jpeg")}), 201)
    staff = make_staff(["service_jobs.view"])
    assert staff.get(f"/service-jobs/{job['code']}/documents/{d['id']}").status_code == 403


def test_unlabelled_upload_is_restricted_by_default(admin, job, make_staff):
    jpg = b"\xff\xd8\xff\xe0" + b"0" * 50
    d = ok(admin.post(f"/service-jobs/{job['code']}/documents", files={"file": ("IMG_20261027.jpg", jpg, "image/jpeg")}), 201)
    staff = make_staff(["service_jobs.view"])
    assert staff.get(f"/service-jobs/{job['code']}/documents/{d['id']}").status_code == 403


# ----------------------------------------------------------------- QA-04 (Medium) lockout counter race


def test_parallel_wrong_passwords_still_lock_after_five(client, make_staff):
    make_staff([], username="race.target")

    def guess(_):
        return client.post("/api/v1/auth/login", json={"username": "race.target", "password": "wrong-password"}).json()["error"]["code"]

    with ThreadPoolExecutor(15) as ex:
        codes = list(ex.map(guess, range(15)))
    assert codes.count("INVALID_CREDENTIALS") <= 5
    r = client.post("/api/v1/auth/login", json={"username": "race.target", "password": PASSWORD})
    assert r.status_code == 429


# ----------------------------------------------------------------- QA-16 (Low) weak passwords / QA-17 (Low) username timing


@pytest.mark.parametrize("weak, why", [
    ("aaaaaaaaaaaa", "Use a mix of different characters."),
    ("short-pw1", "Use at least 10 characters."),
    ("Password123", "This password is too common. Choose another."),
    ("admin-is-me-2026", "Don't include your username in the password."),
])
def test_weak_new_passwords_are_refused(admin, weak, why):
    r = admin.post("/auth/change-password", json={"current_password": PASSWORD, "new_password": weak})
    assert r.status_code == 400 and r.json()["error"]["code"] == "PASSWORD_TOO_WEAK"
    assert r.json()["error"]["field_errors"]["new_password"] == why


def test_strong_new_password_is_accepted(admin):
    assert admin.post("/auth/change-password", json={"current_password": PASSWORD, "new_password": "Counter-desk 7 blue"}).status_code == 204


def test_unknown_username_still_runs_a_password_check(client, monkeypatch):
    from app import security
    calls = []
    real = security.verify_password
    monkeypatch.setattr(security, "verify_password", lambda pw, stored: calls.append(stored) or real(pw, stored))
    r = client.post("/api/v1/auth/login", json={"username": "no.such.user", "password": "whatever-pass"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert calls == [security.DUMMY_HASH]  # same scrypt work as a real account, so timing can't tell them apart


# ----------------------------------------------------------------- QA-05 (Medium) unhandled errors lose CORS + security headers


def test_server_error_keeps_cors_and_security_headers(raw, admin, course, monkeypatch):
    from app.routers import academics

    def boom(*_a, **_k):
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(academics, "course_out", boom)  # any unexpected exception inside a route
    r = raw.get("/api/v1/courses", headers={"Authorization": f"Bearer {admin.token}", "Origin": "http://localhost:5173"})
    assert r.status_code == 500 and r.json()["error"]["code"] == "INTERNAL_ERROR"
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert r.headers.get("x-content-type-options") == "nosniff" and r.headers.get("x-request-id")


# ----------------------------------------------------------------- QA-06 (Medium) payment amounts leak via profile activity


def test_profile_hides_payment_amounts_without_fees_view(student, make_staff):
    staff = make_staff(["students.view"])
    p = ok(staff.get(f"/students/{student['student']['code']}/profile"))
    assert p["fees"] is None
    assert not [a for a in p["activity"] if a["type"] in ("payment", "reversal")]


# ----------------------------------------------------------------- QA-07 (Medium) admission retry is not idempotent


def test_admission_retry_with_same_key_replays(admin, course, enquiry):
    from conftest import admission_body
    h = {"Idempotency-Key": "adm-retry-1"}
    first = ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course), headers=h), 201)
    again = admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course), headers=h)
    assert again.status_code in (200, 201) and again.json()["student"]["code"] == first["student"]["code"]


# ----------------------------------------------------------------- QA-08 (Medium) duplicate admissions


@bug("QA-08", "no duplicate check on Aadhaar hash / mobile+course; the same person can be admitted twice via two enquiries")
def test_same_aadhaar_cannot_be_admitted_twice(admin, course):
    from conftest import admission_body
    for i in range(2):
        e = ok(admin.post("/enquiries", json={"student_name": "Aarav Sharma", "mobile": "9876543210", "course_id": course["id"], "aadhaar": "234567890123"}), 201)
        r = admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(course, paid_now="0", installment_count=1, payment_mode=None))
        if i == 0:
            ok(r, 201)
    assert r.status_code == 409


# ----------------------------------------------------------------- QA-09 (Medium) bill of a cancelled job can be paid


def test_bill_of_cancelled_job_cannot_be_paid(admin, catalog, job):
    b = ok(admin.post("/service-bills", json={"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}), 201)
    ok(admin.post(f"/service-jobs/{job['code']}/status", json={"status": "Cancelled", "reason": "Customer left"}))
    assert admin.post(f"/service-bills/{b['code']}/pay", json={"payment_mode": "Cash"}).status_code == 409


# ----------------------------------------------------------------- QA-10 (Medium) Excel formula injection


def test_excel_export_writes_user_text_as_text(admin):
    ok(admin.post("/customers", json={"full_name": '=HYPERLINK("http://evil.example","x")', "mobile": "9811099999"}), 201)
    wb = openpyxl.load_workbook(io.BytesIO(admin.get("/reports/customer-history/export.xlsx").content))
    assert not [c for row in wb.active.iter_rows() for c in row if c.data_type == "f"]


# ----------------------------------------------------------------- QA-11 (Medium) WhatsApp number not in follow-up payloads


def test_followups_and_student_list_carry_whatsapp_number(admin, course, enquiry):
    from conftest import admission_body
    s = ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(
        course, whatsapp_number="9123456789", paid_now="0", payment_mode=None, installment_count=1, first_due_date=today().isoformat())), 201)
    row = ok(admin.get("/students", params={"q": s["student"]["code"]}))["items"][0]
    follow = [f for f in ok(admin.get("/dashboard/admin"))["fee_followups"] if f["code"] == s["student"]["code"]][0]
    assert row.get("whatsapp_number") == "9123456789" and follow.get("whatsapp_number") == "9123456789"


# ----------------------------------------------------------------- QA-12 (Medium) fees.collect without fees.view


def test_collect_permission_can_load_fee_summary(student, make_staff):
    staff = make_staff(["fees.collect", "students.view"])
    assert staff.get(f"/fees/students/{student['student']['code']}/summary").status_code == 200


# ----------------------------------------------------------------- QA-18 (Low) input validation gaps


@bug("QA-18", "add_months_clamped overflows past year 9999 -> 500")
def test_absurd_first_due_date_is_a_validation_error(raw, admin, course, enquiry):
    from conftest import admission_body
    r = raw.post(f"/api/v1/enquiries/{enquiry['code']}/convert", json=admission_body(course, first_due_date="9999-06-01"),
                 headers={"Authorization": f"Bearer {admin.token}"})
    assert 400 <= r.status_code < 500


@bug("QA-18", "PATCH with null for a NOT NULL column surfaces as 409 CONFLICT instead of a field error")
def test_clearing_required_customer_field_is_a_field_error(admin, catalog):
    r = admin.patch(f"/customers/{catalog['customer']['code']}", json={"mobile": None})
    assert r.status_code in (400, 422) and r.json()["error"]["field_errors"]


@bug("QA-18", "first_due_date may be in the past, creating instantly overdue installments")
def test_first_due_date_in_the_past_is_rejected(admin, course, enquiry):
    from conftest import admission_body
    r = admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course, first_due_date=(today() - timedelta(days=400)).isoformat()))
    assert r.status_code in (400, 422)
