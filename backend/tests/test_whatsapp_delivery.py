import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from pypdf import PdfReader
from sqlalchemy import text

from app import whatsapp_cloud
from app.config import settings
from app.db import engine
from conftest import ok


@pytest.fixture
def graph(monkeypatch):
    for name, value in {
        "enabled": True, "access_token": SecretStr("stub-access-token"), "app_secret": SecretStr("stub-hmac"),
        "verify_token": SecretStr("stub-verify"), "phone_number_id": "5555", "graph_version": "v25.0",
        "receipt_template": "ims_fee_receipt", "bill_template": "ims_paid_bill",
    }.items():
        monkeypatch.setattr(settings, f"whatsapp_{name}", value)
    requests = []
    present, allow = Event(), Event()
    behavior = {"send": "submit"}

    def handle(req):
        requests.append(req)
        assert req.headers["authorization"] == "Bearer stub-access-token"
        assert req.url.host == "graph.facebook.com"
        if req.url.path.endswith("/media"):
            return httpx.Response(200, json={"id": "98765"})
        if behavior["send"] == "hold":
            present.set()
            assert allow.wait(10)
        if behavior["send"] == "timeout":
            raise httpx.ReadTimeout("test timeout", request=req)
        if behavior["send"] == "reject":
            return httpx.Response(400, json={"error": {"code": 132001, "message": "test provider error"}})
        return httpx.Response(200, json={"messages": [{"id": "wamid.test.document"}]})

    monkeypatch.setattr(whatsapp_cloud, "graph_client", lambda: httpx.Client(
        transport=httpx.MockTransport(handle), base_url="https://graph.facebook.com/v25.0/5555/",
        headers={"Authorization": "Bearer stub-access-token"},
    ))
    return requests, behavior, present, allow


def receipt_path(student):
    return f"/receipts/{student['receipt']['receipt_no']}/whatsapp-delivery"


def action(recipient="919876543210", **fields):
    return {"opted_in": True, "recipient": recipient, "attempt_id": str(uuid4())} | fields


def pdf_text(req):
    assert b'Content-Type: application/pdf' in req.content
    start = req.content.index(b"%PDF-")
    end = req.content.index(b"%%EOF", start) + len(b"%%EOF")
    return " ".join(page.extract_text() for page in PdfReader(BytesIO(req.content[start:end])).pages)


def event(client, attempt, status, *, phone_number="5555", timestamp=42, signature=True):
    data = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": phone_number}, "statuses": [{
            "id": "wamid.test.document", "status": status, "timestamp": str(timestamp),
            "recipient_id": attempt["recipient"], "biz_opaque_callback_data": attempt["attempt_id"],
        }]
    }}]}]}
    body = json.dumps(data).encode()
    digest = hmac.new(b"stub-hmac" if signature else b"invalid", body, hashlib.sha256).hexdigest()
    return client.post("/api/v1/webhooks/whatsapp", content=body, headers={"X-Hub-Signature-256": "sha256=" + digest})


def test_receipt_upload_and_verified_delivery(admin, client, student, make_staff, graph):
    requests = graph[0]
    path = receipt_path(student)
    attempt = action()
    assert make_staff(["fees.collect"]).post(path, json=attempt).status_code == 403
    assert admin.post(path, json=attempt | {"opted_in": False}).status_code == 400
    assert admin.post(path, json=attempt | {"recipient": "919811022334"}).status_code == 409
    assert not requests
    assert ok(admin.get(path))["recipient"] == attempt["recipient"]
    assert ok(admin.post(path, json=attempt))["delivery"]["status"] == "submitted"
    assert ok(admin.post(path, json=action()))["delivery"]["status"] == "submitted"
    assert len(requests) == 2
    document = pdf_text(requests[0])
    assert student["receipt"]["receipt_no"] in document and "Aarav Sharma" in document
    assert "Installment schedule" in document and "7500.00" in document
    payload = json.loads(requests[1].content)
    assert payload["to"] == attempt["recipient"]
    assert payload["biz_opaque_callback_data"] == attempt["attempt_id"]
    template = payload["template"]
    assert payload["type"] == "template" and template["name"] == "ims_fee_receipt"
    uploaded = template["components"][0]["parameters"][0]["document"]
    assert uploaded["id"] == "98765" and uploaded["filename"].endswith(".pdf")
    assert event(client, attempt, "delivered", signature=False).status_code == 403
    assert event(client, attempt, "delivered", phone_number="9999").status_code == 204
    assert ok(admin.get(path))["delivery"]["status"] == "submitted"
    for state in ("sent", "delivered", "sent", "read", "failed", "read"):
        assert event(client, attempt, state).status_code == 204
    assert ok(admin.get(path))["delivery"]["status"] == "read"
    webhook = "/api/v1/webhooks/whatsapp"
    verify = {"hub.mode": "subscribe", "hub.verify_token": "stub-verify", "hub.challenge": "90210"}
    assert client.get(webhook, params=verify).text == "90210"
    assert client.get(webhook, params=verify | {"hub.verify_token": "wrong"}).status_code == 403


def test_paid_bill_uses_current_customer_whatsapp_and_keeps_payment(admin, catalog, job, graph):
    requests = graph[0]
    bill = ok(admin.post("/service-bills", json={"job_code": job["code"], "items": [
        {"service_id": catalog["pan"]["id"], "quantity": 2},
    ]}), 201)
    path = f"/service-bills/{bill['code']}"
    attempt = action("919812000010")
    assert admin.post(path + "/whatsapp-delivery", json=attempt).status_code == 409
    ok(admin.patch(f"/customers/{bill['customer']['code']}", json={"whatsapp_number": "9812000010"}))
    ok(admin.post(path + "/pay", json={"payment_mode": "Cash"}))
    before = ok(admin.get(path))
    assert ok(admin.post(path + "/whatsapp-delivery", json=attempt))["delivery"]["status"] == "submitted"
    assert ok(admin.get(path)) == before
    assert "PAN Card - New" in pdf_text(requests[0])
    payload = json.loads(requests[1].content)
    assert payload["to"] == attempt["recipient"] and payload["template"]["name"] == "ims_paid_bill"


def test_failed_attempt_replays_by_id_and_timeout_is_not_resubmitted(admin, student, client, graph):
    requests, behavior, _, _ = graph
    path, first = receipt_path(student), action()
    behavior["send"] = "reject"
    assert ok(admin.post(path, json=first))["delivery"]["result_code"] == "meta_132001"
    assert ok(admin.post(path, json=first))["delivery"]["status"] == "failed"
    behavior["send"] = "timeout"
    second = action()
    assert ok(admin.post(path, json=second))["delivery"]["result_code"] == "confirmation_pending"
    assert ok(admin.post(path, json=action()))["delivery"]["status"] == "pending"
    assert len(requests) == 4
    assert event(client, first, "sent").status_code == 204
    assert ok(admin.get(path))["delivery"]["status"] == "pending"
    assert event(client, second, "delivered").status_code == 204
    assert ok(admin.get(path))["delivery"]["status"] == "delivered"


def test_concurrent_delivery_requests_submit_once(admin, student, graph):
    requests, behavior, present, allow = graph
    path = receipt_path(student)
    behavior["send"] = "hold"
    with ThreadPoolExecutor() as executor:
        first = executor.submit(admin.post, path, json=action())
        try:
            assert present.wait(10)
            assert ok(admin.post(path, json=action()))["delivery"]["status"] == "pending"
        finally:
            allow.set()
        assert ok(first.result())["delivery"]["status"] == "submitted"
    assert len(requests) == 2


def test_disabled_mode_and_migration_rls(admin, student, monkeypatch):
    monkeypatch.setattr(settings, "whatsapp_enabled", False)
    path = receipt_path(student)
    assert not ok(admin.get(path))["available"]
    assert admin.post(path, json=action()).status_code == 503
    with engine.connect() as db:
        assert db.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid='public.whatsapp_document_deliveries'::regclass"))
        assert db.scalar(text("""
            SELECT count(*) FROM information_schema.table_privileges
            WHERE table_name='whatsapp_document_deliveries' AND grantee IN ('PUBLIC','anon','authenticated','service_role')
        """)) == 0
