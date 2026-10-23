"""Action points 1, 2, 3, 11, 12: admission validation, WhatsApp number, IDs, student operations, academics."""
from datetime import date, timedelta
from decimal import Decimal

from app.common import add_months_clamped, today
from app.routers.students import build_schedule
from conftest import YEAR, admission_body, ok


def test_schedule_mirrors_frontend_rule():
    # store.ts: per = floor(rest / n / 50) * 50, last row takes the remainder; dates clamp to month end.
    rows = build_schedule(Decimal("7500"), Decimal("500"), 8, date(2026, 1, 31), date(2026, 1, 15))
    assert rows[0] == (0, date(2026, 1, 15), Decimal("500"))
    assert [r[2] for r in rows[1:]] == [Decimal("850")] * 7 + [Decimal("1050")]
    assert sum(r[2] for r in rows) == Decimal("7500")
    assert [r[1] for r in rows[1:4]] == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]
    assert add_months_clamped(date(2024, 1, 31), 1) == date(2024, 2, 29)


def test_enquiry_validation_and_ids(admin, course):
    r = admin.post("/enquiries", json={"student_name": "X", "mobile": "12345"})
    assert r.status_code == 422 and "mobile" in r.json()["error"]["field_errors"]
    r = admin.post("/enquiries", json={"student_name": "X", "mobile": "9876543210", "aadhaar": "1234"})
    assert r.status_code == 422 and "aadhaar" in r.json()["error"]["field_errors"]
    e = ok(admin.post("/enquiries", json={"student_name": "Riya", "mobile": "+91 98765 43210", "aadhaar": "2345 6789 0123"}), 201)
    assert e["code"] == f"EQ-{YEAR}-0001" and e["mobile"] == "9876543210" and e["aadhaar_masked"] == "XXXX XXXX 0123"
    assert ok(admin.post("/enquiries", json={"student_name": "Kavya", "mobile": "9876543211"}), 201)["code"] == f"EQ-{YEAR}-0002"


def test_follow_up_then_single_conversion(admin, course, enquiry):
    ok(admin.post(f"/enquiries/{enquiry['code']}/followups", json={"status": "Follow-Up", "note": "Called parent"}), 201)
    res = ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course, whatsapp_number="9123456789")), 201)
    s = res["student"]
    assert s["code"] == f"UC-{YEAR}-0001"
    assert s["mobile"] == "9876543210" and s["whatsapp_number"] == "9123456789"  # separate WhatsApp number
    assert res["receipt"]["receipt_no"] == f"RCP-{YEAR}-00001"
    fees = res["fees"]
    assert fees["net_fee"] == "7500.00" and fees["total_paid"] == "500.00" and fees["balance"] == "7000.00"
    assert len(fees["schedule"]) == 9 and fees["schedule"][0]["label"] == "Admission" and fees["schedule"][0]["state"] == "Paid"
    # second conversion is rejected and creates nothing
    r = admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course))
    assert r.status_code == 409 and r.json()["error"]["code"] == "ENQUIRY_ALREADY_CONVERTED"
    assert ok(admin.get("/students"))["total"] == 1
    assert ok(admin.get(f"/enquiries/{enquiry['code']}"))["student_code"] == s["code"]
    acts = ok(admin.get(f"/enquiries/{enquiry['code']}/activities"))
    assert [a["action"] for a in acts] == ["Admission confirmed", "Status updated", "Enquiry created"]
    r = admin.post(f"/enquiries/{enquiry['code']}/followups", json={"status": "Pending"})
    assert r.status_code == 409


def test_admission_rules(admin, course, enquiry):
    code = enquiry["code"]
    other = ok(admin.post("/courses", json={"code": "TALLY", "name": "Tally Prime", "duration_months": 3, "fee": "6500"}), 201)
    other_slot = ok(admin.post("/time-slots", json={"course_id": other["id"], "name": "Tally 11", "start_time": "11:30", "end_time": "13:00", "capacity": 20}), 201)
    cases = [
        ({"course_id": other["id"], "time_slot_id": other_slot["id"]}, 400, "COURSE_MISMATCH"),
        ({"time_slot_id": other_slot["id"]}, 400, "INVALID_TIME_SLOT"),
        ({"paid_now": "8000"}, 400, "PAID_EXCEEDS_NET_FEE"),
        ({"discount": "9000"}, 400, "DISCOUNT_EXCEEDS_FEE"),
        ({"installment_count": 0}, 400, "INSTALLMENTS_REQUIRED"),
        ({"installment_count": 9}, 422, "VALIDATION_ERROR"),
        ({"first_due_date": None}, 400, "FIRST_DUE_DATE_REQUIRED"),
        ({"paid_now": "500", "payment_mode": "Bank"}, 400, "REFERENCE_REQUIRED"),
        ({"guardian_name": ""}, 422, "VALIDATION_ERROR"),
        ({"dob": (today() + timedelta(days=1)).isoformat()}, 422, "VALIDATION_ERROR"),
        ({"total_paid": "7500"}, 422, "VALIDATION_ERROR"),  # client can't send computed fields
    ]
    for over, status, err in cases:
        r = admin.post(f"/enquiries/{code}/convert", json=admission_body(course, **over))
        assert (r.status_code, r.json()["error"]["code"]) == (status, err), (over, r.text)
    # full payment: no installments needed
    res = ok(admin.post(f"/enquiries/{code}/convert", json=admission_body(course, paid_now="7500", installment_count=0, first_due_date=None)), 201)
    assert res["fees"]["fee_state"] == "Fully Paid" and res["receipt"]["next_payment_date"] == "NIL"


def test_capacity_is_a_warning_not_a_block(admin, course):
    warnings = []
    for i in range(3):
        e = ok(admin.post("/enquiries", json={"student_name": f"S{i}", "mobile": f"98765432{i}0", "course_id": course["id"]}), 201)
        warnings.append(ok(admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(course, full_name=f"Student {i}")), 201)["capacity_warning"])
    assert warnings == [False, False, True]  # capacity 2


def test_student_edit_status_archive_and_change_slot(admin, course, student, make_staff):
    code = student["student"]["code"]
    s = ok(admin.patch(f"/students/{code}", json={"whatsapp_number": "9000000001", "address": "New address", "aadhaar": "234567890123"}))
    assert s["whatsapp_number"] == "9000000001" and s["aadhaar_masked"] == "XXXX XXXX 0123"
    assert admin.patch(f"/students/{code}", json={"full_name": None}).status_code == 400
    slot2 = ok(admin.post("/time-slots", json={"course_id": course["id"], "name": "DCA Evening", "start_time": "17:00", "end_time": "18:30", "capacity": 30}), 201)
    moved = ok(admin.post(f"/students/{code}/change-time-slot", json={"time_slot_id": slot2["id"], "reason": "Evening suits"}))
    assert moved["time_slot"]["name"] == "DCA Evening"
    hist = ok(admin.get(f"/students/{code}/time-slot-history"))
    assert hist[0]["from"] == "DCA Morning A" and hist[0]["to"] == "DCA Evening"
    assert admin.post(f"/students/{code}/mark-left", json={"reason": "no"}).status_code == 422
    assert ok(admin.post(f"/students/{code}/mark-left", json={"reason": "Moved to another city"}))["status"] == "Left"
    assert admin.post(f"/students/{code}/mark-completed", json={}).status_code == 409
    viewer = make_staff(["students.view"])
    assert viewer.post(f"/students/{code}/archive", json={"reason": "Duplicate record"}).status_code == 403
    ok(admin.post(f"/students/{code}/archive", json={"reason": "Duplicate record"}))
    assert ok(admin.get("/students"))["total"] == 0
    assert ok(admin.get("/students", params={"include_archived": True}))["total"] == 1
    profile = ok(admin.get(f"/students/{code}/profile"))
    assert {"STUDENT_ARCHIVED", "STUDENT_STATUS_CHANGED", "STUDENT_TIME_SLOT_CHANGED", "STUDENT_UPDATED"} <= {a.get("action") for a in profile["activity"]}


def test_student_search_and_filters(admin, course, student):
    code = student["student"]["code"]
    assert ok(admin.get("/students", params={"q": "aarav"}))["total"] == 1
    assert ok(admin.get("/students", params={"q": "43210"}))["total"] == 1
    assert ok(admin.get("/students", params={"q": code}))["total"] == 1
    assert ok(admin.get("/students", params={"fee_status": "Pending"}))["total"] == 1
    assert ok(admin.get("/students", params={"fee_status": "Fully Paid"}))["total"] == 0
    row = ok(admin.get("/students"))["items"][0]
    assert row["balance"] == "7000.00" and row["paid_pct"] == 7 and "aadhaar" not in row


def test_courses_subtypes_slots(admin, course, student):
    assert course["code"] == "DCA"
    st = ok(admin.post(f"/courses/{course['id']}/subtypes", json={"name": "Weekend"}), 201)
    assert admin.post(f"/courses/{course['id']}/subtypes", json={"name": "WEEKEND"}).status_code == 409
    ok(admin.post(f"/course-subtypes/{st['id']}/deactivate"))
    assert ok(admin.get(f"/courses/{course['id']}/subtypes", params={"active": True})) == []
    r = admin.post("/time-slots", json={"course_id": course["id"], "name": "Late", "start_time": "20:00", "end_time": "21:30", "capacity": 5})
    assert r.status_code == 422
    assert admin.post("/time-slots", json={"course_id": course["id"], "name": "Early", "start_time": "07:59", "end_time": "09:00", "capacity": 5}).status_code == 422
    assert admin.delete(f"/courses/{course['id']}").status_code == 409  # has students: deactivate instead
    ok(admin.patch(f"/courses/{course['id']}", json={"fee": "8000"}))
    assert ok(admin.get(f"/students/{student['student']['code']}"))["agreed_fee"] == "7500.00"  # existing enrolments unchanged
    listed = ok(admin.get("/courses"))[0]
    assert listed["active_students"] == 1 and listed["time_slots"] == 1


def test_aadhaar_reveal_is_admin_only_and_audited(admin, course, make_staff):
    e = ok(admin.post("/enquiries", json={"student_name": "Riya", "mobile": "9876543219", "aadhaar": "234567890123", "course_id": course["id"]}), 201)
    s = ok(admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(course, full_name="Riya Singh")), 201)["student"]
    assert s["aadhaar_masked"] == "XXXX XXXX 0123"  # copied from the enquiry
    staff = make_staff(["students.view", "students.edit"])
    assert staff.get(f"/students/{s['code']}/aadhaar").status_code == 403
    assert ok(admin.get(f"/students/{s['code']}/aadhaar"))["aadhaar"] == "2345 6789 0123"
    assert ok(admin.get("/students", params={"q": "234567890123"}))["total"] == 1  # exact hash search
    logs = ok(admin.get("/audit", params={"action": "AADHAAR_REVEALED"}))["items"]
    assert len(logs) == 1 and "2345" not in str(logs)
