"""Action points 5, 8, 14, 16: fee collection, idempotency, immutable receipts, Admin-only reversal, concurrency."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import FeeReceipt, StudentInstallment, StudentPayment, StudentPaymentAllocation
from app.routers.fees import lock_student, record_payment
from app.security import CurrentUser
from conftest import YEAR, ok


def pay(api, code, amount, mode="Cash", key=None, **kw):
    headers = {"Idempotency-Key": key} if key else {}
    return api.post(f"/fees/students/{code}/payments", json={"amount": amount, "payment_mode": mode, **kw}, headers=headers)


def test_partial_full_and_invalid_payments(admin, student):
    code = student["student"]["code"]
    r = ok(pay(admin, code, "850"), 201)
    assert r["receipt"]["receipt_no"] == f"RCP-{YEAR}-00002"
    snap = r["receipt"]["snapshot"]
    assert (snap["previous_paid"], snap["total_paid"], snap["balance"]) == ("500.00", "1350.00", "6150.00")
    assert snap["amount_in_words"] == "Rupees Eight Hundred Fifty Only"
    assert pay(admin, code, "0").status_code == 422
    assert pay(admin, code, "-5").status_code == 422
    assert pay(admin, code, "10.005").status_code == 422  # more precision than money supports
    assert pay(admin, code, "NaN").status_code == 422
    assert pay(admin, code, "6150.01").json()["error"]["code"] == "AMOUNT_EXCEEDS_BALANCE"
    assert pay(admin, code, "100", "Bank").json()["error"]["code"] == "REFERENCE_REQUIRED"
    assert pay(admin, code, "100", total_paid="1").status_code == 422  # computed fields are rejected
    r = ok(pay(admin, code, "6150", "Bank", reference="UTR123"), 201)
    assert r["receipt"]["next_payment_date"] == "NIL"
    summary = ok(admin.get(f"/fees/students/{code}/summary"))
    assert summary["fee_state"] == "Fully Paid" and summary["balance"] == "0.00" and all(x["state"] == "Paid" for x in summary["schedule"])
    assert pay(admin, code, "1").status_code == 400


def test_allocation_is_fifo_and_matches_payments(admin, student):
    code = student["student"]["code"]
    ok(pay(admin, code, "1000"), 201)  # covers installment 1 (850) + 150 of installment 2
    sched = ok(admin.get(f"/fees/students/{code}/summary"))["schedule"]
    assert [(x["paid"], x["state"]) for x in sched[:3]] == [("500.00", "Paid"), ("850.00", "Paid"), ("150.00", "Partial")]
    with SessionLocal() as db:
        alloc = db.scalar(select(func.sum(StudentPaymentAllocation.allocated_amount)))
        paid = db.scalar(select(func.sum(StudentInstallment.paid_amount)))
        valid = db.scalar(select(func.sum(StudentPayment.amount)).where(StudentPayment.status == "Valid"))
    assert alloc == paid == valid == Decimal("1500.00")


def test_idempotency_key_prevents_double_payment(admin, student):
    code = student["student"]["code"]
    a = ok(pay(admin, code, "850", key="k-1"), 201)
    b = ok(pay(admin, code, "850", key="k-1"), 201)
    assert b["replayed"] and b["payment"]["id"] == a["payment"]["id"]
    assert pay(admin, code, "900", key="k-1").json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert ok(admin.get("/fees/payments", params={"student_code": code}))["total"] == 2  # admission + one


def test_reversal_admin_only_reason_and_history(admin, student, make_staff):
    code = student["student"]["code"]
    p = ok(pay(admin, code, "850"), 201)["payment"]
    staff = make_staff(["fees.view", "fees.collect"])
    assert staff.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "Wrong entry"}).status_code == 403
    assert admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "bad"}).status_code == 422
    r = ok(admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "Duplicate entry"}))
    assert r["status"] == "Reversed" and r["reversed_by"]["name"] == "Rakesh Verma"
    assert admin.post(f"/fees/payments/{p['id']}/reverse", json={"reason": "Duplicate entry"}).json()["error"]["code"] == "PAYMENT_ALREADY_REVERSED"
    assert ok(admin.get(f"/fees/students/{code}/summary"))["balance"] == "7000.00"
    rec = ok(admin.get(f"/receipts/{p['receipt_no']}"))
    assert rec["status"] == "Reversed" and rec["snapshot"]["total_paid"] == "1350.00"  # historical snapshot untouched
    history = ok(admin.get("/fees/payments", params={"student_code": code}))
    assert history["total"] == 2 and history["totals"]["collected"] == "500.00"
    assert ok(admin.get("/receipts"))["total"] == 1  # receipts list hides reversed by default
    entry = ok(admin.get("/audit", params={"category": "deleted"}))["items"][0]
    assert entry["reason"] == "Duplicate entry" and entry["ip_address"] == "testclient"  # request context reaches the audit row


def test_receipt_snapshot_survives_later_changes(admin, student):
    code = student["student"]["code"]
    rno = student["receipt"]["receipt_no"]
    ok(admin.patch(f"/students/{code}", json={"full_name": "Aarav Kumar Sharma"}))
    ok(admin.patch("/settings/institute", json={"name": "New Institute Name"}))
    ok(admin.patch("/settings/receipts", json={"fee_receipt_prefix": "FEE"}))
    snap = ok(admin.get(f"/receipts/{rno}/print-data"))["snapshot"]
    assert snap["student"]["name"] == "Aarav Sharma" and snap["institute"]["name"] == "Updaate Computers"
    assert ok(pay(admin, code, "100"), 201)["receipt"]["receipt_no"] == f"FEE-{YEAR}-00002"  # new prefix for new numbers only


def test_reminders_tabs_and_whatsapp_open(admin, student):
    code = student["student"]["code"]
    res = ok(admin.get("/fees/reminders", params={"tab": "pending"}))
    assert res["total"] == 1 and res["counts"]["pending"] == 1 and res["items"][0]["installment_due"] == "850.00"
    assert res["items"][0]["last_reminded_at"] is None
    ok(admin.post(f"/fees/reminders/{code}/opened-whatsapp", json={}), 201)
    assert ok(admin.get("/fees/reminders", params={"tab": "pending"}))["items"][0]["last_reminded_at"] is not None
    assert ok(admin.get("/fees/reminders", params={"tab": "fully_paid"}))["total"] == 0


def test_concurrent_payments_never_exceed_balance(admin, student):
    """10 parallel requests of 1000 against a 7000 balance: exactly 7 succeed, receipts stay unique."""
    code = student["student"]["code"]
    user = CurrentUser(1, "admin", "Rakesh Verma", "ADMIN")

    def attempt(_):
        with SessionLocal() as db:
            try:
                s = lock_student(db, code)
                record_payment(db, s, Decimal("1000"), "Cash", None, None, user)
                db.commit()
                return True
            except Exception:
                db.rollback()
                return False

    with ThreadPoolExecutor(10) as ex:
        results = list(ex.map(attempt, range(10)))
    assert results.count(True) == 7
    with SessionLocal() as db:
        total = db.scalar(select(func.sum(StudentPayment.amount)).where(StudentPayment.status == "Valid"))
        codes = db.scalars(select(FeeReceipt.receipt_code)).all()
        paid = db.scalar(select(func.sum(StudentInstallment.paid_amount)))
    assert total == paid == Decimal("7500.00")
    assert len(codes) == len(set(codes)) == 8
