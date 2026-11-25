"""Action points 6, 7, 12: jobs workflow, documents, bills (override, full payment, lock, cancel + replacement)."""
from datetime import timedelta

from app.common import today
from conftest import YEAR, ok


def bill_body(job, catalog, **over):
    return {"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}], "discount": "0"} | over


def test_job_create_and_workflow(admin, catalog, job, make_staff):
    assert job["code"] == "SJ-0001" and job["status"] == "Pending" and job["assignees"][0]["name"] == "Rakesh Verma"
    assert job["estimate"] == "250.00"
    ok(admin.post(f"/services/{catalog['print']['id']}/deactivate"))
    r = admin.post("/service-jobs", json={"customer_code": catalog["customer"]["code"], "service_ids": [catalog["print"]["id"]],
                                          "due_date": today().isoformat()})
    assert r.json()["error"]["code"] == "SERVICE_INACTIVE"
    r = admin.post("/service-jobs", json={"customer_code": catalog["customer"]["code"], "service_ids": [catalog["pan"]["id"]],
                                          "due_date": (today() - timedelta(days=1)).isoformat()})
    assert r.status_code == 422
    code = job["code"]
    assert admin.post(f"/service-jobs/{code}/status", json={"status": "Completed"}).json()["error"]["code"] == "INVALID_TRANSITION"
    assert admin.post(f"/service-jobs/{code}/status", json={"status": "On Hold"}).json()["error"]["code"] == "REASON_REQUIRED"
    ok(admin.post(f"/service-jobs/{code}/status", json={"status": "On Hold", "reason": "Waiting for documents"}))
    ok(admin.post(f"/service-jobs/{code}/status", json={"status": "In Process"}))
    done = ok(admin.post(f"/service-jobs/{code}/status", json={"status": "Completed", "reason": "Slip handed over"}))
    assert done["completed_at"] is not None
    for nxt in ("In Process", "Cancelled", "Pending"):  # Completed is final
        assert admin.post(f"/service-jobs/{code}/status", json={"status": nxt, "reason": "reopen"}).status_code == 409
    events = ok(admin.get(f"/service-jobs/{code}/events"))
    assert [e["status"] for e in events if e["type"] in ("Status", "Created")] == ["Completed", "In Process", "On Hold", "Pending"]
    viewer = make_staff(["service_jobs.view"])
    assert viewer.post(f"/service-jobs/{code}/status", json={"status": "Cancelled", "reason": "x"}).status_code == 403


def test_job_list_filters_and_assignment(admin, catalog, job, make_staff):
    staff = make_staff(["service_jobs.view", "service_jobs.assign"], username="amit.k")
    me = ok(staff.get("/auth/me"))
    ok(staff.put(f"/service-jobs/{job['code']}/assignments", json={"user_ids": [me["id"]]}))
    mine = ok(staff.get("/service-jobs", params={"assigned_to_me": True}))
    assert mine["total"] == 1 and mine["items"][0]["assignees"] == [{"id": me["id"], "name": "Amit.K"}]
    assert ok(admin.get("/service-jobs", params={"q": "PAN"}))["total"] == 1
    assert ok(admin.get("/service-jobs", params={"q": "Sunita"}))["total"] == 1
    assert ok(admin.get("/service-jobs", params={"overdue": True}))["total"] == 0
    assert ok(admin.get("/service-jobs"))["status_counts"]["Pending"] == 1


def test_documents_private_validated_and_audited(admin, job, make_staff):
    code = job["code"]
    pdf = b"%PDF-1.4 test document"
    assert admin.post(f"/service-jobs/{code}/documents", files={"file": ("x.exe", b"MZ...", "application/octet-stream")}).status_code == 400
    assert admin.post(f"/service-jobs/{code}/documents", files={"file": ("fake.pdf", b"not a pdf", "application/pdf")}).json()["error"]["code"] == "FILE_TYPE_NOT_ALLOWED"
    big = b"%PDF-" + b"0" * (5 * 1024 * 1024)
    assert admin.post(f"/service-jobs/{code}/documents", files={"file": ("big.pdf", big, "application/pdf")}).json()["error"]["code"] == "FILE_TOO_LARGE"
    # 25 Nov 2026: Aadhaar documents are refused, by type or by file name ("Udyog Aadhaar" is a business registration).
    r = admin.post(f"/service-jobs/{code}/documents", files={"file": ("scan.pdf", pdf, "application/pdf")}, data={"document_type": "Aadhaar Card"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "AADHAAR_NOT_COLLECTED"
    assert admin.post(f"/service-jobs/{code}/documents", files={"file": ("aadhar_front.jpg", b"\xff\xd8\xff\xe0x", "image/jpeg")}).json()["error"]["code"] == "AADHAAR_NOT_COLLECTED"
    udyog = ok(admin.post(f"/service-jobs/{code}/documents", files={"file": ("udyog_aadhaar_certificate.pdf", pdf, "application/pdf")}), 201)
    assert admin.delete(f"/service-jobs/{code}/documents/{udyog['id']}").status_code == 204
    doc = ok(admin.post(f"/service-jobs/{code}/documents", files={"file": ("pan.pdf", pdf, "application/pdf")},
                        data={"document_type": "PAN Card"}), 201)
    assert doc["sensitive"] and "storage" not in str(doc)
    staff = make_staff(["service_jobs.view"])
    assert staff.get(f"/service-jobs/{code}/documents/{doc['id']}").status_code == 403
    r = admin.get(f"/service-jobs/{code}/documents/{doc['id']}")
    assert r.status_code == 200 and r.content == pdf
    photo = ok(admin.post(f"/service-jobs/{code}/documents", files={"file": ("photo.png", b"\x89PNG\r\n\x1a\nxx", "image/png")},
                          data={"document_type": "Passport Photo"}), 201)
    assert not photo["sensitive"] and staff.get(f"/service-jobs/{code}/documents/{photo['id']}").status_code == 200
    assert staff.delete(f"/service-jobs/{code}/documents/{doc['id']}").status_code == 403
    assert admin.delete(f"/service-jobs/{code}/documents/{doc['id']}").status_code == 204
    assert len(ok(admin.get(f"/service-jobs/{code}/documents"))) == 1
    actions = {a["action"] for a in ok(admin.get("/audit", params={"entity_type": "Service Job"}))["items"]}
    assert {"DOCUMENT_UPLOADED", "DOCUMENT_VIEWED", "DOCUMENT_DELETED"} <= actions


def test_bill_create_override_and_totals(admin, catalog, job, make_staff):
    staff = make_staff(["service_bill.create", "service_jobs.view"])
    r = staff.post("/service-bills", json=bill_body(job, catalog, items=[{"service_id": catalog["pan"]["id"], "quantity": 1, "rate": "200"}]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "RATE_OVERRIDE_NOT_ALLOWED"
    r = admin.post("/service-bills", json=bill_body(job, catalog, discount="999"))
    assert r.json()["error"]["code"] == "DISCOUNT_EXCEEDS_SUBTOTAL"
    items = [{"service_id": catalog["pan"]["id"], "quantity": 1, "rate": "200"},
             {"service_id": catalog["print"]["id"], "quantity": 10}, {"service_id": catalog["print"]["id"], "quantity": 5}]
    b = ok(admin.post("/service-bills", json=bill_body(job, catalog, items=items, discount="5")), 201)
    assert b["code"] == f"SB-{YEAR}-0001"
    assert [(i["name"], i["quantity"], i["line_amount"], i["overridden"]) for i in b["items"]] == [
        ("PAN Card - New", 1, "200.00", True), ("B/W Print (per page)", 15, "45.00", False)]  # same service + rate combined
    assert (b["subtotal"], b["discount"], b["grand_total"]) == ("245.00", "5.00", "240.00")
    assert b["created_by"]["name"] == "Rakesh Verma" and b["paid_by"] is None
    assert admin.post("/service-bills", json=bill_body(job, catalog)).json()["error"]["code"] == "BILL_ALREADY_EXISTS"
    assert {"BILL_CREATED", "BILL_RATE_OVERRIDDEN"} <= {a["action"] for a in ok(admin.get("/audit", params={"entity_type": "Service Bill"}))["items"]}


def test_full_payment_lock_cancel_and_replacement(admin, catalog, job, make_staff):
    staff = make_staff(["service_bill.create", "service_jobs.view"], username="priya.s")
    b = ok(staff.post("/service-bills", json=bill_body(job, catalog)), 201)
    code = b["code"]
    ok(staff.patch(f"/service-bills/{code}", json={"items": [{"service_id": catalog["pan"]["id"], "quantity": 2}], "discount": "50"}))
    assert staff.post(f"/service-bills/{code}/pay", json={"payment_mode": "Bank"}).json()["error"]["code"] == "REFERENCE_REQUIRED"
    assert staff.post(f"/service-bills/{code}/pay", json={"payment_mode": "Cash", "amount": "100"}).status_code == 422  # no partial amount accepted
    paid = ok(staff.post(f"/service-bills/{code}/pay", json={"payment_mode": "GPay"}, headers={"Idempotency-Key": "bill-1"}))
    assert paid["status"] == "Paid" and paid["payment"]["amount"] == "450.00" and paid["paid_by"]["name"] == "Priya.S"
    assert ok(staff.post(f"/service-bills/{code}/pay", json={"payment_mode": "GPay"}, headers={"Idempotency-Key": "bill-1"}))["replayed"]
    assert staff.post(f"/service-bills/{code}/pay", json={"payment_mode": "Cash"}).json()["error"]["code"] == "BILL_ALREADY_PAID"
    assert staff.patch(f"/service-bills/{code}", json={"items": [{"service_id": catalog["pan"]["id"], "quantity": 1}]}).json()["error"]["code"] == "BILL_LOCKED"
    assert staff.post(f"/service-bills/{code}/cancel", json={"reason": "Wrong service billed"}).status_code == 403
    assert admin.post(f"/service-bills/{code}/cancel", json={"reason": "no"}).status_code == 422
    c = ok(admin.post(f"/service-bills/{code}/cancel", json={"reason": "Wrong service billed"}))
    assert c["status"] == "Cancelled" and c["payment"] is not None and len(c["items"]) == 1  # history kept
    assert admin.post(f"/service-bills/{code}/cancel", json={"reason": "Wrong service billed"}).status_code == 409
    rep = ok(admin.post("/service-bills", json=bill_body(job, catalog)), 201)  # replacement bill, new number
    assert rep["code"] == f"SB-{YEAR}-0002" and rep["replaces"] == [code]
    r = admin.post(f"/service-bills/{rep['code']}/pay", json={"payment_mode": "Cash"})
    assert r.json()["error"]["code"] == "PREVIOUS_PAYMENT_UNRESOLVED"  # never double-collect


def test_cancelled_jobs_cannot_be_billed_and_unpaid_replacement_can_be_paid(admin, catalog, job):
    b = ok(admin.post("/service-bills", json=bill_body(job, catalog)), 201)
    ok(admin.post(f"/service-bills/{b['code']}/cancel", json={"reason": "Customer changed the order"}))
    rep = ok(admin.post("/service-bills", json=bill_body(job, catalog)), 201)
    assert ok(admin.post(f"/service-bills/{rep['code']}/pay", json={"payment_mode": "Cash"}))["status"] == "Paid"
    ok(admin.post(f"/service-jobs/{job['code']}/status", json={"status": "Cancelled", "reason": "Customer withdrew"}))
    j2 = ok(admin.post("/service-jobs", json={"customer_code": catalog["customer"]["code"], "service_ids": [catalog["pan"]["id"]],
                                              "due_date": today().isoformat()}), 201)
    ok(admin.post(f"/service-jobs/{j2['code']}/status", json={"status": "Cancelled", "reason": "Customer withdrew"}))
    assert admin.post("/service-bills", json=bill_body(j2, catalog)).json()["error"]["code"] == "JOB_CANCELLED"
    totals = ok(admin.get("/service-bills"))["totals"]
    assert totals["Paid"] == {"amount": "250.00", "count": 1} and totals["Cancelled"]["count"] == 1


def test_customers_and_service_master(admin, catalog, job):
    dup = ok(admin.post("/customers", json={"full_name": "Another Sunita", "mobile": "98110 22334"}), 201)
    assert dup["code"] == "CU-0002" and dup["duplicate_mobile_of"][0]["code"] == "CU-0001"  # warn, don't block
    hist = ok(admin.get(f"/customers/{catalog['customer']['code']}/history"))
    assert hist["jobs"][0]["code"] == job["code"]
    ok(admin.patch(f"/services/{catalog['pan']['id']}", json={"price": "300"}))
    assert ok(admin.get("/audit", params={"action": "SERVICE_RATE_UPDATED"}))["items"][0]["before"] == {"price": "250.00"}
    assert ok(admin.get(f"/service-jobs/{job['code']}"))["estimate"] == "250.00"  # intake price snapshot unchanged
    assert admin.post("/service-categories", json={"name": "identity documents"}).status_code == 409
    assert admin.delete(f"/service-categories/{catalog['cat']['id']}").status_code == 409
