"""16 Nov client meeting: (2) installment dates and amounts set by hand, at admission and later;
(3) service jobs no longer have a "Last date"."""
from datetime import timedelta

from app.common import today
from conftest import admission_body, ok


def d(days):
    return (today() + timedelta(days=days)).isoformat()


def plan(fees):
    return [(r["label"], r["due_date"], r["amount"], r["paid"]) for r in fees["schedule"]]


# ----------------------------------------------------------------- (2) admission with a hand-set plan


def test_admission_with_hand_set_dates_and_amounts(admin, course, enquiry):
    # client's example: 500 today, 1000 on a chosen date, the rest later (course fee 7500)
    body = admission_body(course, installment_count=0, first_due_date=None,
                          installments=[{"due_date": d(10), "amount": "1000"}, {"due_date": d(40), "amount": "2500"}, {"due_date": d(70), "amount": "3500"}])
    out = ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=body), 201)
    assert plan(out["fees"]) == [("Admission", today().isoformat(), "500.00", "500.00"), ("Installment 1", d(10), "1000.00", "0.00"),
                                 ("Installment 2", d(40), "2500.00", "0.00"), ("Installment 3", d(70), "3500.00", "0.00")]
    assert out["fees"]["next_due"] == {"due_date": d(10), "amount": "1000.00", "label": "Installment 1"}
    snap = out["receipt"]["snapshot"]["installments"]
    assert [(i["due_date"], i["amount"]) for i in snap] == [(d(10), "1000.00"), (d(40), "2500.00"), (d(70), "3500.00")]


def test_hand_set_plan_must_add_up_and_be_in_order(admin, course, enquiry):
    url = f"/enquiries/{enquiry['code']}/convert"

    def err(rows):
        r = admin.post(url, json=admission_body(course, installments=rows))
        assert r.status_code == 400, r.text
        return r.json()["error"]["code"]

    assert err([{"due_date": d(10), "amount": "1000"}]) == "INSTALLMENTS_TOTAL_MISMATCH"  # 7000 is due
    assert err([{"due_date": d(40), "amount": "3500"}, {"due_date": d(10), "amount": "3500"}]) == "INSTALLMENT_DATES_ORDER"
    assert err([{"due_date": d(-1), "amount": "7000"}]) == "INSTALLMENT_DATE_INVALID"
    assert err([{"due_date": d(5), "amount": "7000"}, {"due_date": d(9), "amount": "0"}]) == "INSTALLMENT_AMOUNT_INVALID"
    assert err([]) == "INSTALLMENTS_REQUIRED"
    assert admin.get(f"/enquiries/{enquiry['code']}").json()["status"] != "Converted"  # nothing was saved


def test_old_even_split_still_works(student):
    rows = plan(student["fees"])
    assert len(rows) == 9 and rows[1][2] == "850.00"  # admission_body: 8 monthly installments, as before


# ----------------------------------------------------------------- (2) changing the plan later


def test_change_plan_keeps_money_already_received(admin, course, enquiry):
    body = admission_body(course, installments=[{"due_date": d(10), "amount": "1000"}, {"due_date": d(40), "amount": "6000"}])
    s = ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=body), 201)["student"]["code"]
    ok(admin.post(f"/fees/students/{s}/payments", json={"amount": "600", "payment_mode": "Cash"}), 201)  # part of installment 1
    fees = ok(admin.put(f"/students/{s}/installment-plan", json={"installments": [
        {"due_date": d(20), "amount": "2400"}, {"due_date": d(50), "amount": "2000"}, {"due_date": d(80), "amount": "2000"}], "reason": "Parent asked"}))
    assert plan(fees) == [("Admission", today().isoformat(), "500.00", "500.00"), ("Installment 1", d(10), "600.00", "600.00"),
                          ("Installment 2", d(20), "2400.00", "0.00"), ("Installment 3", d(50), "2000.00", "0.00"), ("Installment 4", d(80), "2000.00", "0.00")]
    assert fees["total_paid"] == "1100.00" and fees["balance"] == "6400.00" and fees["net_fee"] == "7500.00"
    log = ok(admin.get("/audit", params={"q": "Installment plan changed"}))["items"]
    assert log and log[0]["action"] == "FEE_PLAN_CHANGED"


def test_change_plan_rules_and_who_may(admin, make_staff, student):
    code = student["student"]["code"]
    url = f"/students/{code}/installment-plan"
    r = admin.put(url, json={"installments": [{"due_date": d(30), "amount": "100"}]})
    assert r.json()["error"]["code"] == "INSTALLMENTS_TOTAL_MISMATCH"  # must equal the 7000 balance
    viewer = make_staff(["students.view", "fees.view"])
    assert viewer.put(url, json={"installments": [{"due_date": d(30), "amount": "7000"}]}).status_code == 403
    collector = make_staff(["students.view", "fees.view", "fees.collect"])
    ok(collector.put(url, json={"installments": [{"due_date": d(30), "amount": "7000"}]}))  # client: Admin + staff who collect fees
    ok(admin.post(f"/fees/students/{code}/payments", json={"amount": "7000", "payment_mode": "Cash"}), 201)
    done = admin.put(url, json={"installments": [{"due_date": d(30), "amount": "1"}]})
    assert done.status_code == 409 and done.json()["error"]["code"] == "FEES_FULLY_PAID"


def test_reversal_after_plan_change_still_balances(admin, course, enquiry):
    s = ok(admin.post(f"/enquiries/{enquiry['code']}/convert", json=admission_body(course)), 201)
    code = s["student"]["code"]
    pay = ok(admin.post(f"/fees/students/{code}/payments", json={"amount": "1000", "payment_mode": "Cash"}), 201)
    ok(admin.put(f"/students/{code}/installment-plan", json={"installments": [{"due_date": d(15), "amount": "6000"}]}))
    ok(admin.post(f"/fees/payments/{pay['payment']['id']}/reverse", json={"reason": "Cheque bounced"}))
    fees = ok(admin.get(f"/fees/students/{code}/summary"))
    assert fees["total_paid"] == "500.00" and fees["balance"] == "7000.00"
    assert sum(float(r["amount"]) for r in fees["schedule"]) == 7500


# ----------------------------------------------------------------- (3) no "Last date" on service jobs


def test_job_without_last_date(admin, catalog):
    j = ok(admin.post("/service-jobs", json={"customer_code": catalog["customer"]["code"], "service_ids": [catalog["pan"]["id"]]}), 201)
    assert j["service_date"] == today().isoformat() and j["due_date"] is None and j["overdue"] is False
    rows = ok(admin.get("/reports/pending-jobs"))["items"]
    assert rows[0]["job"] == j["code"] and rows[0]["days_open"] == 0 and "last_date" not in rows[0]


# ----------------------------------------------------------------- (1) several sub-types per student / enquiry


def subtypes(admin, course, *names):
    return [ok(admin.post(f"/courses/{course['id']}/subtypes", json={"name": n}), 201)["id"] for n in names]


def test_enquiry_and_admission_with_several_sub_types(admin, course):
    excel, tally, _ = subtypes(admin, course, "Advance excel", "Tally", "Photoshop")
    e = ok(admin.post("/enquiries", json={"student_name": "Riya Patil", "mobile": "9876501234", "course_id": course["id"],
                                          "course_subtype_ids": [excel, tally]}), 201)
    assert [x["name"] for x in e["course_subtypes"]] == ["Advance excel", "Tally"] and e["course_subtype"]["name"] == "Advance excel"
    out = ok(admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(course, full_name="Riya Patil", course_subtype_ids=[excel, tally])), 201)
    assert [x["name"] for x in out["student"]["course_subtypes"]] == ["Advance excel", "Tally"]
    assert out["receipt"]["snapshot"]["course_subtype"] == "Advance excel, Tally"
    assert out["fees"]["net_fee"] == "7500.00"  # sub-types never change the fee


def test_change_sub_types_later_and_audit(admin, student, course):
    excel, tally, ps = subtypes(admin, course, "Advance excel", "Tally", "Photoshop")
    code = student["student"]["code"]
    s = ok(admin.patch(f"/students/{code}", json={"course_subtype_ids": [tally, ps]}))
    assert [x["name"] for x in s["course_subtypes"]] == ["Tally", "Photoshop"]
    s = ok(admin.patch(f"/students/{code}", json={"course_subtype_ids": []}))
    assert s["course_subtypes"] == [] and s["course_subtype"] is None
    log = ok(admin.get("/audit", params={"q": code}))["items"]
    assert any(i["action"] == "STUDENT_UPDATED" for i in log)


def test_sub_types_must_belong_to_the_course(admin, course):
    other = ok(admin.post("/courses", json={"code": "tal", "name": "Tally Prime", "duration_months": 3, "fee": "4000"}), 201)
    mine = subtypes(admin, course, "Advance excel")[0]
    theirs = ok(admin.post(f"/courses/{other['id']}/subtypes", json={"name": "GST"}), 201)["id"]
    r = admin.post("/enquiries", json={"student_name": "Riya Patil", "mobile": "9876501234", "course_id": course["id"], "course_subtype_ids": [mine, theirs]})
    assert r.status_code == 400 and r.json()["error"]["code"] == "SUBTYPE_MISMATCH"


def test_older_single_sub_type_field_still_works(admin, course):
    excel = subtypes(admin, course, "Advance excel")[0]
    e = ok(admin.post("/enquiries", json={"student_name": "Old Screen", "mobile": "9876501299", "course_id": course["id"], "course_subtype_id": excel}), 201)
    assert [x["id"] for x in e["course_subtypes"]] == [excel]
    e = ok(admin.patch(f"/enquiries/{e['code']}", json={"student_name": "Old Screen Two"}))  # untouched fields keep the sub-types
    assert [x["id"] for x in e["course_subtypes"]] == [excel]
    e = ok(admin.patch(f"/enquiries/{e['code']}", json={"course_id": course["id"]}))  # as before: sending a course clears them
    assert e["course_subtypes"] == []


def test_pranavs_sql_copies_existing_single_sub_types():
    """The SQL for the shared database runs cleanly (twice) and copies today's single sub-type into the new tables."""
    import pathlib
    from sqlalchemy import text
    from app.db import engine
    sql = (pathlib.Path(__file__).parents[1] / "sql" / "2026-11-16_several_sub_types_per_student.sql").read_text()
    body = sql.split("-- Check:")[0]
    check = sql.split("-- Check:")[1].split("\n", 1)[1].split("/* ----")[0]
    with engine.begin() as c:
        c.exec_driver_sql(body)
        c.exec_driver_sql(body)
        assert tuple(c.execute(text(check)).one()) == (0, 0)
