"""Sprint Day 3 (30 Oct 2026) acceptance checks: search permissions, Aadhaar reveal audit, live alert counts, audit fields, staff matrix.

Task IDs from IMS_Dhruvank_3_Day_Consolidated_Work_Plan_28_to_30_Oct_2026.md. Each test is the evidence for its task.
"""
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.common import today
from app.db import engine
from conftest import admission_body, ok

AADHAAR = "234567890123"


@pytest.fixture
def world(admin, course, catalog, job):
    """One student with Aadhaar and an overdue installment, one unpaid bill, one receipt."""
    e = ok(admin.post("/enquiries", json={"student_name": "Meera Joshi", "mobile": "9876500011", "course_id": course["id"], "aadhaar": AADHAAR}), 201)
    s = ok(admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(
        course, full_name="Meera Joshi", mobile="9876500011", whatsapp_number="9123400011", paid_now="500", installment_count=2,
        first_due_date=(today() - timedelta(days=5)).isoformat())), 201)
    ok(admin.post("/service-bills", json={"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}), 201)
    return {"enquiry": e["code"], "student": s["student"]["code"], "receipt": s["receipt"]["receipt_no"], "customer": catalog["customer"]}


# ----------------------------------------------------------------- D3-02 global search permission filtering


def test_d3_02_search_returns_only_groups_the_user_may_see(admin, world, make_staff):
    full = ok(admin.get("/search", params={"q": "Meera"}))
    assert full["students"] and full["students"][0]["code"] == world["student"] and full["enquiries"]
    customers_only = make_staff(["customers.view"])
    r = ok(customers_only.get("/search", params={"q": "Meera"}))
    assert set(r) == {"customers"} and r["customers"] == []  # no student or enquiry data leaks
    assert ok(customers_only.get("/search", params={"q": "Sunita"}))["customers"][0]["label"] == "Sunita Devi"
    receipts_only = make_staff(["receipts.view_print"])
    r = ok(receipts_only.get("/search", params={"q": world["receipt"]}))
    assert set(r) == {"receipts"} and r["receipts"][0]["code"] == world["receipt"]
    assert ok(make_staff([]).get("/search", params={"q": "Meera"})) == {}


# ----------------------------------------------------------------- D3-03 Aadhaar masking / reveal / audit


def test_d3_03_aadhaar_masked_encrypted_admin_reveal_audited(admin, world, make_staff):
    viewer = make_staff(["students.view", "fees.view", "receipts.view_print", "reports.view", "audit.view"])
    masked = "XXXX XXXX 0123"
    assert ok(viewer.get(f"/students/{world['student']}"))["aadhaar_masked"] == masked
    assert ok(viewer.get(f"/enquiries/{world['enquiry']}"))["aadhaar_masked"] == masked
    assert ok(viewer.get("/students", params={"q": "Meera"}))["items"][0]["aadhaar_masked"] == masked
    with engine.connect() as c:
        ct = c.execute(text("SELECT aadhaar_ciphertext FROM students WHERE student_code=:c"), {"c": world["student"]}).scalar()
    assert AADHAAR.encode() not in bytes(ct)  # encrypted at rest
    assert viewer.get(f"/students/{world['student']}/aadhaar").status_code == 403
    assert viewer.get(f"/enquiries/{world['enquiry']}/aadhaar").status_code == 403
    assert ok(admin.get(f"/students/{world['student']}/aadhaar"))["aadhaar"] == "2345 6789 0123"
    ok(admin.get(f"/enquiries/{world['enquiry']}/aadhaar"))
    rows = ok(admin.get("/audit", params={"action": "AADHAAR_REVEALED"}))["items"]
    assert {r["entity_id"] for r in rows} == {world["student"], world["enquiry"]} and all(r["actor"]["name"] == "Rakesh Verma" for r in rows)
    assert AADHAAR not in admin.get("/audit", params={"page_size": 100}).text and "2345 6789 0123" not in admin.get("/audit", params={"page_size": 100}).text


# ----------------------------------------------------------------- D3-04 / D3-05 sidebar counts and notifications from live data


def test_d3_05_alert_counts_match_the_database_and_follow_permissions(admin, world, make_staff):
    with engine.connect() as c:
        unpaid = c.execute(text("SELECT count(*) FROM service_bills WHERE status='Unpaid'")).scalar()
        open_jobs = c.execute(text("SELECT count(*) FROM service_jobs WHERE status IN ('Pending','In Process')")).scalar()
    n = ok(admin.get("/meta/notifications"))
    side = ok(admin.get("/meta/sidebar"))
    assert n["overdue_fees"] == 1 and n["unpaid_bills"] == unpaid == 1
    assert side["open_jobs"] == open_jobs and side["fee_reminders"] >= 1
    follow = [f for f in ok(admin.get("/dashboard/admin"))["fee_followups"] if f["code"] == world["student"]][0]
    assert follow["overdue_days"] == 5 and follow["whatsapp_number"] == "9123400011"
    blind = make_staff([])
    assert ok(blind.get("/meta/notifications")) == {"overdue_fees": None, "urgent_jobs": None, "unpaid_bills": None, "recent_activity": []}
    assert ok(blind.get("/meta/sidebar")) == {"fee_reminders": None, "open_jobs": None}


# ----------------------------------------------------------------- D3-06 audit fields for sensitive actions


def test_d3_06_audit_records_actor_time_reason_and_record(admin, world, catalog):
    pay = ok(admin.post(f"/fees/students/{world['student']}/payments", json={"amount": "100", "payment_mode": "Cash"}), 201)
    ok(admin.post(f"/fees/payments/{pay['payment']['id']}/reverse", json={"reason": "Entered twice"}))
    bill = ok(admin.get("/service-bills"))["items"][0]["code"]
    ok(admin.post(f"/service-bills/{bill}/cancel", json={"reason": "Customer withdrew"}))
    ok(admin.patch(f"/students/{world['student']}", json={"address": "New address, Pune"}))
    ok(admin.get(f"/students/{world['student']}/aadhaar"))
    rows = {r["action"]: r for r in ok(admin.get("/audit", params={"page_size": 100}))["items"]}
    expect = {"PAYMENT_REVERSED": (pay["receipt"]["receipt_no"], "Entered twice"), "BILL_CANCELLED": (bill, "Customer withdrew"),
              "STUDENT_UPDATED": (world["student"], None), "AADHAAR_REVEALED": (world["student"], None)}
    for action, (record, reason) in expect.items():
        r = rows[action]
        assert r["actor"]["name"] == "Rakesh Verma" and r["at"] and r["entity_id"] == record, action
        assert r["reason"] == reason, action
    assert rows["STUDENT_UPDATED"]["after"] == {"address": "New address, Pune"}


# ----------------------------------------------------------------- D3-07 staff permission regression (touched endpoints)

MATRIX = [  # (method, path template, permission that opens it)
    ("GET", "/students", "students.view"),
    ("GET", "/enquiries", "students.view"),
    ("GET", "/fees/payments", "fees.view"),
    ("GET", "/fees/students/{student}/summary", "fees.collect"),
    ("GET", "/receipts", "receipts.view_print"),
    ("GET", "/fees/reminders", "reminders.view"),
    ("GET", "/customers", "customers.view"),
    ("GET", "/service-jobs", "service_jobs.view"),
    ("GET", "/service-bills", "service_bill.create"),
    ("GET", "/expenses", "expenses.view"),
    ("GET", "/finance/daily-cash", "reports.view"),
    ("GET", "/dashboard/admin", "reports.view"),
    ("GET", "/audit", "audit.view"),
]
ADMIN_ONLY = [("GET", "/staff"), ("GET", "/permissions"), ("PATCH", "/settings/institute"), ("GET", "/backups"),
              ("GET", "/students/{student}/aadhaar"), ("POST", "/fees/payments/1/reverse"), ("POST", "/service-bills/X/cancel")]


def test_d3_07_staff_access_matrix(admin, world, make_staff):
    """One staff account (the 4-Staff cap is real); permissions changed by the Admin between checks, enforced on the next request."""
    staff = make_staff([], username="matrix.user")
    uid = [u for u in ok(admin.get("/staff"))["items"] if u["username"] == "matrix.user"][0]["id"]

    def call(method, url):
        return getattr(staff, method.lower())(url, **({} if method == "GET" else {"json": {}}))

    for method, path, perm in MATRIX:
        url = path.format(student=world["student"])
        ok(admin.put(f"/staff/{uid}/permissions", json={"codes": []}))
        assert call(method, url).status_code == 403, (method, url, "no permission")
        ok(admin.put(f"/staff/{uid}/permissions", json={"codes": [perm]}))
        assert call(method, url).status_code == 200, (method, url, perm)
    everything = ["students.view", "students.create", "students.edit", "students.delete", "fees.view", "fees.collect", "receipts.view_print",
                  "reminders.view", "customers.view", "customers.manage", "service_jobs.view", "service_bill.create", "expenses.view",
                  "reports.view", "audit.view"]
    ok(admin.put(f"/staff/{uid}/permissions", json={"codes": everything}))
    for method, path in ADMIN_ONLY:
        url = path.format(student=world["student"])
        assert call(method, url).status_code == 403, (method, url)
