"""19 Nov client updates: (1) WhatsApp sends go to the registered number; (2) course sub-type fees;
(3) time slots for a sub-type."""
import pathlib

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import engine
from conftest import admission_body, ok


def subtype(admin, course, name, fee=None):
    return ok(admin.post(f"/courses/{course['id']}/subtypes", json={"name": name, "fee": fee}), 201)


def slot(admin, course, name, subtype_id=None, start="10:00", end="11:00"):
    return ok(admin.post("/time-slots", json={"course_id": course["id"], "course_subtype_id": subtype_id, "name": name,
                                              "start_time": start, "end_time": end, "capacity": 20}), 201)


def enquiry(admin, course, mobile="9876509876"):
    return ok(admin.post("/enquiries", json={"student_name": "Test Student", "mobile": mobile, "course_id": course["id"]}), 201)


# ----------------------------------------------------------------- (1) WhatsApp recipient


def test_receipt_carries_the_registered_whatsapp_number(admin, course):
    e = enquiry(admin, course)
    body = admission_body(course, whatsapp_number="9123456780")
    out = ok(admin.post(f"/enquiries/{e['code']}/convert", json=body), 201)
    assert out["receipt"]["send_to"] == {"name": body["full_name"], "whatsapp_number": "9123456780"}
    code = out["student"]["code"]
    no = out["receipt"]["receipt_no"]
    ok(admin.patch(f"/students/{code}", json={"whatsapp_number": "9988776655"}))  # changed later: the live number is used
    r = ok(admin.get(f"/receipts/{no}"))
    assert r["send_to"]["whatsapp_number"] == "9988776655" and r["snapshot"]["student"]["mobile"] == body["mobile"]  # snapshot untouched
    assert ok(admin.get(f"/fees/students/{code}/summary"))["student"]["whatsapp_number"] == "9988776655"


def test_sharing_changes_nothing_about_money(admin, course):
    out = ok(admin.post(f"/enquiries/{enquiry(admin, course)['code']}/convert", json=admission_body(course)), 201)
    code, no = out["student"]["code"], out["receipt"]["receipt_no"]
    before = ok(admin.get(f"/fees/students/{code}/summary"))
    receipts = ok(admin.get("/receipts"))["total"]
    for event in ("WHATSAPP_OPENED", "NATIVE_PDF_SHARE_OPENED"):
        assert admin.post(f"/receipts/{no}/share-events", json={"event_type": event}).status_code == 204
    assert admin.post(f"/receipts/{no}/share-events", json={"event_type": "DELIVERED"}).status_code == 422
    log = ok(admin.get("/audit", params={"q": no}))["items"]
    assert any(i["action"] == "RECEIPT_SHARED" and "device PDF sharing opened" in i["summary"] for i in log)
    after = ok(admin.get(f"/fees/students/{code}/summary"))
    assert after["total_paid"] == before["total_paid"] and after["balance"] == before["balance"]
    assert ok(admin.get("/receipts"))["total"] == receipts and ok(admin.get(f"/receipts/{no}"))["status"] == "Valid"


def test_paid_bill_share_uses_live_customer_whatsapp_and_preserves_payment(admin, catalog, job):
    customer = catalog["customer"]
    path = f"/customers/{customer['code']}"
    ok(admin.patch(path, json={"whatsapp_number": "9123456780"}))
    bill = ok(admin.post("/service-bills", json={"job_code": job["code"],
        "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}), 201)
    bill_path = f"/service-bills/{bill['code']}"
    paid = ok(admin.post(f"{bill_path}/pay", json={"payment_mode": "Cash"}))
    assert paid["customer"]["whatsapp_number"] == "9123456780"
    for event in ("WHATSAPP_OPENED", "NATIVE_PDF_SHARE_OPENED"):
        assert admin.post(f"{bill_path}/share-events", json={"event_type": event}).status_code == 204
    log = ok(admin.get("/audit", params={"q": bill["code"]}))["items"]
    assert any(i["action"] == "BILL_SHARED" and "device PDF sharing opened" in i["summary"] for i in log)
    current = ok(admin.get(bill_path))
    assert current["status"] == "Paid" and current["payment"] == paid["payment"]
    assert current["items"] == paid["items"] and current["grand_total"] == paid["grand_total"]
    assert ok(admin.get("/service-bills"))["total"] == 1


# ----------------------------------------------------------------- (2) sub-type fees


def test_subtype_fee_create_edit_clear_and_validation(admin, course, make_staff):
    st = subtype(admin, course, "Basic", "4000")
    assert st["fee"] == "4000.00"
    assert ok(admin.patch(f"/course-subtypes/{st['id']}", json={"fee": "4500.50"}))["fee"] == "4500.50"
    assert ok(admin.patch(f"/course-subtypes/{st['id']}", json={"name": "Basic Plus"}))["fee"] == "4500.50"  # rename keeps fee
    assert ok(admin.patch(f"/course-subtypes/{st['id']}", json={"fee": None}))["fee"] is None
    for bad_fee in ("-1", "12.345", "abc", "1e12"):
        assert admin.patch(f"/course-subtypes/{st['id']}", json={"fee": bad_fee}).status_code == 422, bad_fee
    listed = [c for c in ok(admin.get("/courses")) if c["id"] == course["id"]][0]["subtypes"]
    assert listed == [{"id": st["id"], "name": "Basic Plus", "fee": None}]
    viewer = make_staff(["students.view"])
    assert viewer.patch(f"/course-subtypes/{st['id']}", json={"fee": "1"}).status_code == 403
    log = ok(admin.get("/audit", params={"q": "Basic"}))["items"]
    assert any(i["action"] == "COURSE_SUBTYPE_UPDATED" for i in log)


@pytest.mark.parametrize("ticked, expected", [
    ([], "7500.00"),                       # no sub-type: course fee, as before
    (["unpriced"], "7500.00"),             # sub-type without its own fee: course fee
    (["basic"], "4000.00"),                # priced sub-type replaces the course fee
    (["basic", "advanced"], "10000.00"),   # several priced: each counted once
    (["basic", "unpriced"], "4000.00"),    # unpriced ones add nothing
])
def test_admission_fee_from_subtypes(admin, course, ticked, expected):
    ids = {"basic": subtype(admin, course, "Basic", "4000")["id"], "advanced": subtype(admin, course, "Advanced", "6000")["id"],
           "unpriced": subtype(admin, course, "Theory")["id"]}
    chosen = [ids[k] for k in ticked]
    out = ok(admin.post(f"/enquiries/{enquiry(admin, course)['code']}/convert",
                        json=admission_body(course, course_subtype_ids=chosen + chosen[:1], installment_count=2)), 201)  # a duplicate tick
    assert out["student"]["agreed_fee"] == expected and out["fees"]["net_fee"] == expected
    rows = out["fees"]["schedule"]
    assert sum(float(r["amount"]) for r in rows) == float(expected)  # installments add up to the sub-type fee


def test_fee_change_later_keeps_enrolled_students_and_receipts(admin, course):
    st = subtype(admin, course, "Basic", "4000")
    out = ok(admin.post(f"/enquiries/{enquiry(admin, course)['code']}/convert", json=admission_body(course, course_subtype_ids=[st["id"]])), 201)
    ok(admin.patch(f"/course-subtypes/{st['id']}", json={"fee": "9000"}))
    s = ok(admin.get(f"/students/{out['student']['code']}"))
    assert s["agreed_fee"] == "4000.00"
    assert ok(admin.get(f"/receipts/{out['receipt']['receipt_no']}"))["snapshot"] == out["receipt"]["snapshot"]


def test_zero_fee_is_configured_and_admission_totals_cannot_overflow(admin, course):
    free = subtype(admin, course, "Free", "0")["id"]
    out = ok(admin.post(f"/enquiries/{enquiry(admin, course)['code']}/convert",
                        json=admission_body(course, course_subtype_ids=[free], paid_now="0", installment_count=0)), 201)
    assert out["student"]["agreed_fee"] == "0.00" and out["receipt"] is None
    a = subtype(admin, course, "A", "9999999999.99")["id"]
    b = subtype(admin, course, "B", "0.01")["id"]
    url = f"/enquiries/{enquiry(admin, course, '9876509877')['code']}/convert"
    r = admin.post(url, json=admission_body(course, course_subtype_ids=[a, b]))
    assert r.status_code == 400 and r.json()["error"]["code"] == "ADMISSION_FEE_TOO_HIGH"


def test_receipt_preserves_paise_in_payment_and_installments(admin, course):
    st = subtype(admin, course, "Paise fee", "1400.25")["id"]
    body = admission_body(course, course_subtype_ids=[st], discount="20.10", paid_now="500.20", installment_count=1)
    out = ok(admin.post(f"/enquiries/{enquiry(admin, course)['code']}/convert", json=body), 201)
    assert out["fees"]["net_fee"] == "1380.15" and out["fees"]["balance"] == "879.95"
    assert out["receipt"]["snapshot"]["amount_in_words"] == "Rupees Five Hundred and Twenty Paise Only"


# ----------------------------------------------------------------- (3) sub-type time slots


def test_time_slot_subtype_create_edit_and_cross_course(admin, course):
    other = ok(admin.post("/courses", json={"code": "oth", "name": "Other Course", "duration_months": 3, "fee": "3000"}), 201)
    mine = subtype(admin, course, "Basic", "4000")
    theirs = ok(admin.post(f"/courses/{other['id']}/subtypes", json={"name": "GST"}), 201)
    s = slot(admin, course, "Basic Morning", mine["id"])
    assert s["course_subtype"] == {"id": mine["id"], "name": "Basic"}
    r = admin.post("/time-slots", json={"course_id": course["id"], "course_subtype_id": theirs["id"], "name": "Wrong",
                                         "start_time": "10:00", "end_time": "11:00", "capacity": 5})
    assert r.status_code == 400 and r.json()["error"]["code"] == "SUBTYPE_MISMATCH"
    assert admin.patch(f"/time-slots/{s['id']}", json={"course_subtype_id": theirs["id"]}).json()["error"]["code"] == "SUBTYPE_MISMATCH"
    assert ok(admin.patch(f"/time-slots/{s['id']}", json={"course_subtype_id": None}))["course_subtype"] is None
    assert ok(admin.patch(f"/time-slots/{s['id']}", json={"course_subtype_id": mine["id"], "faculty": "New Teacher"}))["course_subtype"]["id"] == mine["id"]
    listed = {x["id"]: x for x in ok(admin.get("/time-slots", params={"course_id": course["id"]}))}
    assert listed[s["id"]]["course_subtype"]["name"] == "Basic" and listed[s["id"]]["faculty"] == "New Teacher"


def test_existing_whole_course_slots_untouched(admin, course):
    slots = ok(admin.get("/time-slots", params={"course_id": course["id"]}))
    assert slots and all(x["course_subtype"] is None for x in slots)  # the fixture's slot is a whole-course slot


def test_admission_only_accepts_a_compatible_batch(admin, course):
    basic, adv = subtype(admin, course, "Basic", "4000"), subtype(admin, course, "Advanced", "6000")
    adv_slot = slot(admin, course, "Advanced Evening", adv["id"], "17:00", "18:00")
    body = admission_body(course, course_subtype_ids=[basic["id"]], time_slot_id=adv_slot["id"])
    r = admin.post(f"/enquiries/{enquiry(admin, course)['code']}/convert", json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "TIME_SLOT_SUBTYPE_MISMATCH"
    ok(admin.post(f"/enquiries/{enquiry(admin, course, '9876509877')['code']}/convert",
                  json=admission_body(course, course_subtype_ids=[adv["id"]], time_slot_id=adv_slot["id"])), 201)
    ok(admin.post(f"/enquiries/{enquiry(admin, course, '9876509878')['code']}/convert",
                  json=admission_body(course, course_subtype_ids=[basic["id"]])), 201)  # whole-course slot fits everyone


def test_compatibility_check_is_read_only_and_database_enforces_same_course():
    sql = (pathlib.Path(__file__).parents[1] / "sql" / "2026-11-19_subtype_fees_and_subtype_time_slots.sql").read_text()
    with engine.begin() as c:
        c.exec_driver_sql("SET TRANSACTION READ ONLY")
        assert tuple(c.exec_driver_sql(sql).one()) == (True, True)
    with engine.connect() as c:
        a = c.execute(text("INSERT INTO courses (code, name, duration, fee) VALUES ('SQLA', 'SQL A', '3', 100) RETURNING id")).scalar()
        b = c.execute(text("INSERT INTO courses (code, name, duration, fee) VALUES ('SQLB', 'SQL B', '3', 100) RETURNING id")).scalar()
        st = c.execute(text("INSERT INTO course_subtypes (course_id, name) VALUES (:b, 'x') RETURNING id"), {"b": b}).scalar()
        with pytest.raises(IntegrityError, match="time_slots_course_subtype_fk"):
            c.execute(text("INSERT INTO time_slots (course_id, course_subtype_id, name, start_time, end_time, days_of_week, capacity) "
                           "VALUES (:a, :st, 'bad', '10:00', '11:00', 'Mon', 5)"), {"a": a, "st": st})
        c.rollback()
