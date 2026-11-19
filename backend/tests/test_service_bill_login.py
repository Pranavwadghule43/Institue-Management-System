from pathlib import Path

from sqlalchemy import text

from app.db import engine
from conftest import ok


def test_bill_username_lifecycle_and_password_is_never_saved(admin, catalog, job, make_staff, caplog):
    username = 'service_<customer>@example.test'
    password = 'SYNTHETIC!password&only'
    items = [{"service_id": catalog["pan"]["id"], "quantity": 1}]
    payload = {"job_code": job["code"], "items": items, "service_login_username": username}
    rejected = admin.post("/service-bills", json=payload | {"service_login_password": password})
    assert rejected.status_code == 422 and password not in rejected.text
    created = ok(admin.post("/service-bills", json=payload), 201)
    code = created["code"]
    path = f"/service-bills/{code}"
    assert created["service_login_username"] == ok(admin.get(path))["service_login_username"] == username
    assert username not in admin.get(path + "/print-data").text
    assert username not in admin.get("/service-bills").text
    assert make_staff(["service_jobs.view"]).get(path).status_code == 403
    assert ok(admin.patch(path, json={"items": items}))["service_login_username"] == username
    assert ok(admin.patch(path, json={"items": items, "service_login_username": ""}))["service_login_username"] is None
    updated = ok(admin.patch(path, json={"items": items, "service_login_username": "x" * 256}))
    assert updated["service_login_username"] == "x" * 256
    assert admin.patch(path, json={"items": items, "service_login_username": "x" * 257}).status_code == 422
    paid = ok(admin.post(f"{path}/pay", json={"payment_mode": "Cash"}))
    assert paid["service_login_username"] == updated["service_login_username"]
    assert admin.patch(path, json={"items": items, "service_login_username": "unintended-change"}).status_code == 409
    assert ok(admin.get(path))["payment"] == paid["payment"]
    assert username not in admin.get("/audit").text and password not in caplog.text


def test_service_login_migration_keeps_existing_bill(admin, catalog, job):
    bill = ok(admin.post("/service-bills", json={
        "job_code": job["code"], "items": [{"service_id": catalog["pan"]["id"], "quantity": 1}],
    }), 201)
    migration = Path(__file__).resolve().parents[1] / "sql" / "2026-11-20_service_bill_login_username.sql"
    # Restore the previous table shape on the disposable fixture, then run the real migration.
    with engine.begin() as db:
        db.exec_driver_sql("ALTER TABLE public.service_bills DROP COLUMN service_login_username")
        db.exec_driver_sql(migration.read_text(encoding="utf-8"))
        row = db.execute(text("SELECT grand_total, service_login_username FROM service_bills WHERE bill_code=:code"),
                         {"code": bill["code"]}).one()
        assert str(row.grand_total) == bill["grand_total"] and row.service_login_username is None
