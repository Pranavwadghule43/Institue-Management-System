"""Sprint Day 2 (29 Oct 2026) acceptance checks: batch/status audit, paid-bill lock, bill actors, receipt snapshot, reversal.

Task IDs from IMS_Dhruvank_3_Day_Consolidated_Work_Plan_28_to_30_Oct_2026.md. Each test is the evidence for its task.
"""
from decimal import Decimal

from conftest import ok


def _pay(api, code, amount, mode="Cash"):
    return ok(api.post(f"/fees/students/{code}/payments", json={"amount": amount, "payment_mode": mode}), 201)


# ----------------------------------------------------------------- D2-01 student status / batch


def test_d2_01_batch_change_is_validated_and_audited(admin, course, student):
    code = student["student"]["code"]
    other = ok(admin.post("/courses", json={"code": "tally", "name": "Tally Prime", "duration_months": 3, "fee": "4500"}), 201)
    foreign = ok(admin.post("/time-slots", json={"course_id": other["id"], "name": "Tally Noon", "start_time": "12:00", "end_time": "13:00",
                                                 "capacity": 10}), 201)
    r = admin.post(f"/students/{code}/change-time-slot", json={"time_slot_id": foreign["id"], "reason": "wrong course"})
    assert r.json()["error"]["code"] == "INVALID_TIME_SLOT"  # slot must belong to the student's course
    evening = ok(admin.post("/time-slots", json={"course_id": course["id"], "name": "DCA Evening", "start_time": "19:00", "end_time": "20:30",
                                                 "capacity": 20}), 201)
    ok(admin.post(f"/students/{code}/change-time-slot", json={"time_slot_id": evening["id"], "reason": "Prefers evening"}))
    hist = ok(admin.get(f"/students/{code}/time-slot-history"))
    assert hist[0]["to"] == "DCA Evening" and hist[0]["by"]["name"] == "Rakesh Verma" and hist[0]["at"]
    assert admin.post(f"/students/{code}/mark-left", json={"reason": "x"}).status_code == 422  # reason required
    ok(admin.post(f"/students/{code}/mark-left", json={"reason": "Moved to another city"}))
    assert ok(admin.get(f"/students/{code}"))["status"] == "Left"
    actions = {a["action"] for a in ok(admin.get("/audit", params={"q": code}))["items"]}
    assert {"STUDENT_TIME_SLOT_CHANGED", "STUDENT_STATUS_CHANGED"} <= actions


# ----------------------------------------------------------------- D2-02 paid-bill lock, cancel, replacement


def test_d2_02_paid_bill_is_locked_for_everyone_and_replacement_gets_a_new_number(admin, catalog, job, make_staff):
    staff = make_staff(["service_bill.create", "service_jobs.view"])
    line = [{"service_id": catalog["pan"]["id"], "quantity": 1}]
    b = ok(staff.post("/service-bills", json={"job_code": job["code"], "items": line}), 201)
    ok(staff.post(f"/service-bills/{b['code']}/pay", json={"payment_mode": "Cash"}))
    tamper = {"items": [{"service_id": catalog["pan"]["id"], "quantity": 5}], "discount": "0"}
    assert staff.patch(f"/service-bills/{b['code']}", json=tamper).json()["error"]["code"] == "BILL_LOCKED"
    assert admin.patch(f"/service-bills/{b['code']}", json=tamper).json()["error"]["code"] == "BILL_LOCKED"
    assert staff.post(f"/service-bills/{b['code']}/cancel", json={"reason": "Wrong service"}).status_code == 403
    assert admin.post(f"/service-bills/{b['code']}/cancel", json={}).status_code == 422  # reason required
    c = ok(admin.post(f"/service-bills/{b['code']}/cancel", json={"reason": "Wrong service billed"}))
    assert c["status"] == "Cancelled" and c["payment"]["amount"] == "250.00" and c["items"]  # history preserved
    rep = ok(admin.post("/service-bills", json={"job_code": job["code"], "items": line}), 201)
    assert rep["code"] != b["code"] and rep["replaces"] == [b["code"]]
    # Open product decision (QA-02): collecting on the replacement is blocked until the refund rule exists.
    assert admin.post(f"/service-bills/{rep['code']}/pay", json={"payment_mode": "Cash"}).json()["error"]["code"] == "PREVIOUS_PAYMENT_UNRESOLVED"
    audit = ok(admin.get("/audit", params={"q": b["code"], "category": "deleted"}))["items"]
    assert audit[0]["action"] == "BILL_CANCELLED" and audit[0]["reason"] == "Wrong service billed"


# ----------------------------------------------------------------- D2-05 creator vs collector


def test_d2_05_bills_i_closed_counts_the_collector_not_the_creator(catalog, job, make_staff):
    creator = make_staff(["service_bill.create", "service_jobs.view"], username="bill.creator")
    collector = make_staff(["service_bill.create", "service_jobs.view"], username="bill.collector")
    b = ok(creator.post("/service-bills", json={"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}), 201)
    paid = ok(collector.post(f"/service-bills/{b['code']}/pay", json={"payment_mode": "Cash"}))
    assert paid["created_by"]["name"] == "Bill.Creator" and paid["paid_by"]["name"] == "Bill.Collector" and paid["paid_at"]
    assert ok(collector.get("/dashboard/me"))["bills_closed_today"] == {"amount": "250.00", "count": 1}
    assert ok(creator.get("/dashboard/me"))["bills_closed_today"] == {"amount": "0.00", "count": 0}
    assert ok(collector.get("/dashboard/me"))["cash_to_hand_over"] == "250.00"


# ----------------------------------------------------------------- D2-08 immutable receipt snapshot


def test_d2_08_receipt_snapshot_survives_later_payment_settings_edit_and_reversal(admin, student):
    code = student["student"]["code"]
    first = _pay(admin, code, "1000")
    before = ok(admin.get(f"/receipts/{first['receipt']['receipt_no']}"))
    later = _pay(admin, code, "750", "GPay")
    ok(admin.patch("/settings/institute", json={"name": "Renamed Institute", "address": "New address"}))
    ok(admin.patch("/settings/receipts", json={"receipt_footer": "Changed footer"}))
    ok(admin.post(f"/fees/payments/{later['payment']['id']}/reverse", json={"reason": "Entered twice"}))
    ok(admin.post(f"/fees/payments/{first['payment']['id']}/reverse", json={"reason": "Cheque bounced"}))
    after = ok(admin.get(f"/receipts/{first['receipt']['receipt_no']}"))
    assert after["snapshot"] == before["snapshot"]  # every printed field unchanged
    assert after["next_payment_date"] == before["next_payment_date"]
    for k in ("previous_paid", "total_paid", "balance", "net_fee", "next_payment_date"):
        assert after["snapshot"][k] == before["snapshot"][k]
    assert (before["status"], after["status"]) == ("Valid", "Reversed") and after["reversal_reason"] == "Cheque bounced"


# ----------------------------------------------------------------- D2-09 reversal authorization + reconciliation


def test_d2_09_only_admin_reverses_and_the_ledger_reconciles(admin, student, make_staff):
    code = student["student"]["code"]
    all_but_admin = make_staff(["fees.view", "fees.collect", "receipts.view_print", "students.view"])
    p = _pay(admin, code, "1250")["payment"]
    assert all_but_admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "Staff attempt"}).status_code == 403
    assert admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "no"}).status_code == 422
    before = ok(admin.get(f"/fees/students/{code}/summary"))
    ok(admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "Wrong student"}))
    after = ok(admin.get(f"/fees/students/{code}/summary"))
    assert Decimal(after["balance"]) - Decimal(before["balance"]) == Decimal("1250")
    assert Decimal(after["total_paid"]) == sum(Decimal(r["paid"]) for r in after["schedule"])  # allocation rebuilt, no double count
    valid = [x for x in ok(admin.get("/fees/payments", params={"student_code": code}))["items"] if x["status"] == "Valid"]
    assert Decimal(after["total_paid"]) == sum(Decimal(x["amount"]) for x in valid)
    assert admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "Again please"}).status_code == 409
    rev = ok(admin.get("/audit", params={"action": "PAYMENT_REVERSED"}))["items"][0]
    assert rev["reason"] == "Wrong student" and rev["actor"]["name"] == "Rakesh Verma"
