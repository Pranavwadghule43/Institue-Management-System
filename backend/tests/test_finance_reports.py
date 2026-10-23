"""Action points 9, 10, 12, 13, 14, 16: expenses, Daily Cash, P&L, dashboards, search, sidebar, all 25 reports + exports, reconciliation."""
import io
from datetime import timedelta
from decimal import Decimal

import pytest
from openpyxl import load_workbook

from app.common import today
from app.routers.reports import REPORTS
from conftest import admission_body, ok


@pytest.fixture
def day(admin, course, student, catalog, job):
    """One day of activity: 500 admission + 850 fee (reversed 300 one) + 450 paid bill + unpaid + cancelled bill + 2 expenses (1 deleted)."""
    code = student["student"]["code"]
    ok(admin.post(f"/fees/students/{code}/payments", json={"amount": "850", "payment_mode": "GPay"}), 201)
    rev = ok(admin.post(f"/fees/students/{code}/payments", json={"amount": "300", "payment_mode": "Cash"}), 201)["payment"]
    ok(admin.post(f"/fees/payments/{rev['id']}/reverse", json={"reason": "Entered twice"}))
    b = ok(admin.post("/service-bills", json={"job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 2}], "discount": "50"}), 201)
    ok(admin.post(f"/service-bills/{b['code']}/pay", json={"payment_mode": "Cash"}))
    jobs = [ok(admin.post("/service-jobs", json={"customer_code": catalog["customer"]["code"], "service_ids": [catalog["print"]["id"]],
                                                 "due_date": today().isoformat()}), 201) for _ in range(2)]
    ok(admin.post("/service-bills", json={"job_code": jobs[0]["code"], "items": [{"service_id": catalog["print"]["id"], "quantity": 10}]}), 201)  # unpaid
    c = ok(admin.post("/service-bills", json={"job_code": jobs[1]["code"], "items": [{"service_id": catalog["print"]["id"], "quantity": 20}]}), 201)
    ok(admin.post(f"/service-bills/{c['code']}/pay", json={"payment_mode": "PhonePe"}))
    ok(admin.post(f"/service-bills/{c['code']}/cancel", json={"reason": "Billed to the wrong customer"}))
    cats = {x["name"]: x["id"] for x in ok(admin.get("/expense-categories"))}
    ok(admin.post("/expenses", json={"amount": "240", "category_id": cats["Refreshments"], "payment_mode": "Cash", "description": "Tea & snacks"}), 201)
    gone = ok(admin.post("/expenses", json={"amount": "999", "category_id": cats["Other"], "payment_mode": "Cash", "description": "Typo"}), 201)
    assert admin.delete(f"/expenses/{gone['code']}").status_code == 204
    return {"code": code}


def test_expenses_rules(admin):
    cats = {x["name"]: x["id"] for x in ok(admin.get("/expense-categories"))}
    assert len(cats) == 11 and "Other" in cats
    assert admin.post("/expenses", json={"amount": "0", "category_id": cats["Rent"], "payment_mode": "Bank", "description": "x"}).status_code == 422
    future = (today() + timedelta(days=1)).isoformat()
    assert admin.post("/expenses", json={"amount": "10", "expense_date": future, "category_id": cats["Rent"], "payment_mode": "Cash",
                                         "description": "x"}).json()["error"]["code"] == "FUTURE_DATE"
    e = ok(admin.post("/expenses", json={"amount": "18000", "category_id": cats["Rent"], "payment_mode": "Bank", "description": "Shop rent"}), 201)
    assert e["code"] == "EX-0001"
    ok(admin.patch(f"/expenses/{e['code']}", json={"amount": "18500"}))
    assert ok(admin.get("/expenses", params={"period": "month"}))["total_amount"] == "18500.00"
    assert admin.post("/expense-categories", json={"name": "rent"}).status_code == 409
    new = ok(admin.post("/expense-categories", json={"name": "Software"}), 201)
    ok(admin.patch(f"/expense-categories/{new['id']}", json={"is_active": False}))
    assert admin.post("/expenses", json={"amount": "1", "category_id": new["id"], "payment_mode": "Cash", "description": "x"}).json()["error"]["code"] == "INVALID_CATEGORY"


def test_daily_cash_reconciles(admin, day):
    d = ok(admin.get("/finance/daily-cash", params={"date": today().isoformat()}))
    # fees 500 + 850 (300 reversed excluded); services 450 (unpaid + cancelled excluded); expenses 240 (deleted excluded)
    assert (d["fees"], d["services"], d["expenses"], d["net"]) == ("1350.00", "450.00", "240.00", "1560.00")
    by = {m["mode"]: m for m in d["by_mode"]}
    assert (by["Cash"]["in"], by["Cash"]["out"], by["Cash"]["net"]) == ("950.00", "240.00", "710.00")
    assert by["GPay"]["in"] == "850.00" and by["PhonePe"]["in"] == "0.00"
    assert sum(Decimal(m["net"]) for m in d["by_mode"]) == Decimal(d["net"])
    assert sum(Decimal(x["amount"]) for x in d["ledger"]) == Decimal(d["net"]) and d["counts"] == {"receipts": 2, "paid_bills": 1, "expenses": 1}


def test_pnl_dashboard_and_reports_agree(admin, day):
    pnl = ok(admin.get("/finance/pnl", params={"period": "month"}))
    assert (pnl["student_fee_income"], pnl["service_income"], pnl["expenses"], pnl["net_profit"]) == ("1350.00", "450.00", "240.00", "1560.00")
    assert pnl["service_profit"] == {"revenue": "450.00", "cost": None, "profit": None, "calculation_status": "pending_cost_rule"}
    assert pnl["monthly_trend"][-1]["net"] == "1560.00" and len(pnl["monthly_trend"]) == 12
    for period in ("today", "week", "financial_year"):
        assert ok(admin.get("/finance/pnl", params={"period": period}))["net_profit"] == "1560.00"
    assert admin.get("/finance/pnl", params={"period": "custom"}).status_code == 400
    k = ok(admin.get("/dashboard/admin", params={"trend_days": 7}))
    assert k["kpis"]["net_income_today"] == "1560.00" and k["kpis"]["pending_fees"] == "6150.00" and k["kpis"]["admissions_today"] == 1
    assert len(k["trend"]) == 7 and k["service_desk"]["unpaid_bills"] == 1 and k["last_receipt"]["amount"] == "850.00"
    rep = lambda slug, **p: ok(admin.get(f"/reports/{slug}", params=p))
    assert rep("fee-collection")["totals"]["amount"] == "1350.00"
    assert rep("payment-history")["totals"]["valid_amount"] == "1350.00"
    assert rep("service-income")["totals"]["amount"] == "450.00"
    assert rep("daily-cash")["totals"] == {"fees": "1350.00", "services": "450.00", "expenses": "240.00", "net": "1560.00"}
    assert rep("pnl")["totals"]["net"] == "1560.00" and rep("monthly-income")["totals"]["total"] == "1800.00"
    assert rep("expense")["totals"]["amount"] == "240.00"
    assert rep("pending-fee")["totals"]["balance"] == "6150.00"
    assert rep("service-revenue")["items"][0] == {"service": "PAN Card - New", "times_billed": 1, "quantity": 2, "gross_revenue": "500.00"}
    assert rep("cancelled-bills")["items"][0]["was_paid"] == "Yes"
    assert {i["action"] for i in rep("deleted-records")["items"]} == {"PAYMENT_REVERSED", "BILL_CANCELLED", "EXPENSE_DELETED"}
    assert rep("service-payment")["totals"]["amount"] == "450.00"
    assert rep("fee-collection", payment_mode="GPay")["totals"]["amount"] == "850.00"


def test_all_25_reports_run_and_export(admin, day, make_staff):
    catalog = ok(admin.get("/reports"))
    assert len(catalog) == 25 == len(REPORTS) and all(r["exports"] == ["xlsx"] for r in catalog)
    for r in catalog:
        res = ok(admin.get(f"/reports/{r['slug']}", params={"page_size": 5}))
        assert len(res["items"]) <= 5 and res["columns"]
        x = admin.get(f"/reports/{r['slug']}/export.xlsx")
        assert x.status_code == 200 and x.headers["content-type"].startswith("application/vnd.openxmlformats")
        ws = load_workbook(io.BytesIO(x.content)).active
        assert ws["A1"].value == r["name"]
    assert ok(admin.get("/reports/service-profit"))["items"][0]["cost"] is None
    assert admin.get("/reports/nope").status_code == 404
    assert admin.get("/reports/fee-collection", params={"date_from": "2026-02-01", "date_to": "2026-01-01"}).status_code == 400
    viewer = make_staff(["reports.view"])
    assert viewer.get("/reports/staff-activity").status_code == 403  # audit-derived reports need audit.view
    assert len(ok(viewer.get("/reports"))) == 23


def test_search_sidebar_notifications_and_staff_dashboard(admin, day, make_staff, client):
    res = ok(admin.get("/search", params={"q": "Aarav"}))
    assert res["students"][0]["code"] == day["code"] and res["enquiries"]
    assert ok(admin.get("/search", params={"q": "RCP"}))["receipts"]
    assert admin.get("/search", params={"q": "a"}).status_code == 422
    side = ok(admin.get("/meta/sidebar"))
    assert side == {"fee_reminders": 0, "open_jobs": 3}
    note = ok(admin.get("/meta/notifications"))
    assert note["overdue_fees"] == 0 and note["unpaid_bills"] == 1 and len(note["recent_activity"]) == 3
    staff = make_staff(["service_jobs.view"])
    assert ok(staff.get("/meta/sidebar")) == {"fee_reminders": None, "open_jobs": 3}
    assert ok(staff.get("/search", params={"q": "Aarav"})) == {"service_jobs": []}  # no student access -> no student group
    me = ok(admin.get("/dashboard/me"))
    assert me["fees_collected_today"] == {"amount": "1350.00", "receipts": 2}
    assert me["bills_closed_today"] == {"amount": "450.00", "count": 1}
    assert me["cash_to_hand_over"] == "710.00"  # cash fees 500 + cash bill 450 - cash expense 240


def test_admission_payment_shows_in_every_view(admin, course):
    e = ok(admin.post("/enquiries", json={"student_name": "Riya", "mobile": "9876500000", "course_id": course["id"]}), 201)
    ok(admin.post(f"/enquiries/{e['code']}/convert", json=admission_body(course, paid_now="7500", installment_count=0, first_due_date=None)), 201)
    assert ok(admin.get("/finance/daily-cash"))["fees"] == "7500.00"
    assert ok(admin.get("/reports/course-wise"))["items"][0]["collected"] == "7500.00"
