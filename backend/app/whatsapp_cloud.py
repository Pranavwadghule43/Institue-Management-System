"""Official Meta Cloud API client. The outcome of an uncertain send stays pending."""
import re
from dataclasses import dataclass

import httpx
import phonenumbers

from .config import settings
from .timing import timed_operation


def enabled() -> bool:
    return bool(
        settings.whatsapp_enabled
        and settings.whatsapp_access_token.get_secret_value()
        and settings.whatsapp_app_secret.get_secret_value()
        and settings.whatsapp_verify_token.get_secret_value()
        and re.fullmatch(r"[0-9]+", settings.whatsapp_phone_number_id)
        and re.fullmatch(r"v[0-9]+\.[0-9]+", settings.whatsapp_graph_version)
        and re.fullmatch(r"[a-z0-9_]+", settings.whatsapp_receipt_template)
        and re.fullmatch(r"[a-z0-9_]+", settings.whatsapp_bill_template)
        and re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", settings.whatsapp_template_language)
    )


def normalize_number(number: str | None) -> str | None:
    if not number or not re.fullmatch(r"[+0-9() .\-]+", number.strip()):
        return None
    digits = re.sub(r"\D", "", number)
    if number.strip().startswith("+") or (len(digits) == 12 and digits.startswith("91")):
        digits = "+" + digits
    try:
        parsed = phonenumbers.parse(digits, "IN")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)[1:]


@dataclass(frozen=True)
class SendResult:
    status: str
    code: str | None = None
    message_id: str | None = None


def provider_message_id(value) -> str | None:
    return value if isinstance(value, str) and 7 <= len(value) <= 255 and value.startswith("wamid.") else None


def json_object(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def graph_client() -> httpx.Client:
    return httpx.Client(
        base_url=f"https://graph.facebook.com/{settings.whatsapp_graph_version}/{settings.whatsapp_phone_number_id}/",
        headers={"Authorization": f"Bearer {settings.whatsapp_access_token.get_secret_value()}"},
        timeout=httpx.Timeout(12, connect=5), trust_env=False,
    )


def send_document(kind: str, recipient: str, attempt: str, filename: str, pdf: bytes) -> SendResult:
    name = settings.whatsapp_receipt_template if kind == "receipt" else settings.whatsapp_bill_template
    with graph_client() as client:
        try:
            with timed_operation("whatsapp_upload"):
                upload = client.post("media", data={"messaging_product": "whatsapp", "type": "application/pdf"},
                                     files={"file": (filename, pdf, "application/pdf")})
        except httpx.RequestError:
            return SendResult("failed", "media_unavailable")
        media_id = json_object(upload).get("id")
        if not upload.is_success or not isinstance(media_id, str) or not media_id.isdigit():
            return SendResult("failed", "media_rejected")

        body = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "template",
            "biz_opaque_callback_data": attempt,
            "template": {
                "name": name,
                "language": {"code": settings.whatsapp_template_language},
                "components": [{"type": "header", "parameters": [
                    {"type": "document", "document": {"id": media_id, "filename": filename}},
                ]}],
            },
        }
        try:
            with timed_operation("whatsapp_submit"):
                response = client.post("messages", json=body)
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout):
            return SendResult("failed", "provider_unavailable")
        except httpx.RequestError:
            return SendResult("pending", "confirmation_pending")
        data = json_object(response)
        messages = data.get("messages")
        if response.is_success and isinstance(messages, list) and messages and isinstance(messages[0], dict):
            if message_id := provider_message_id(messages[0].get("id")):
                return SendResult("submitted", message_id=message_id)
        error = data.get("error")
        if 400 <= response.status_code < 500 and isinstance(error, dict) and type(error.get("code")) is int:
            return SendResult("failed", f"meta_{error['code']}")
        return SendResult("pending", "confirmation_pending")
