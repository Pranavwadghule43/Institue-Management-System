"""Render private PDFs from the same persisted values used by IMS print views."""
from functools import lru_cache
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .common import local_date


@lru_cache(maxsize=1)
def register_font(path: str) -> str:
    if not path:
        return "Helvetica"
    pdfmetrics.registerFont(TTFont("IMSDocument", path, shapable=True))
    return "IMSDocument"


def render_pdf(kind: str, data: dict, font_path: str) -> bytes:
    institute = data["institute"]
    font = register_font(font_path)
    base = ParagraphStyle("body", fontName=font, fontSize=10, leading=15, shaping=bool(font_path))
    title = ParagraphStyle("title", parent=base, fontSize=21, leading=26, textColor=colors.HexColor("#17345A"))
    heading = ParagraphStyle("heading", parent=base, fontSize=13, leading=18, textColor=colors.HexColor("#17345A"))

    def para(value, style=base):
        value = str(value)
        if not font_path:
            value.encode("cp1252")  # fail clearly rather than producing missing glyphs
        return Paragraph(escape(value).replace("\n", "<br/>"), style)

    def table(rows, widths, header=False):
        grid = Table([[para(cell) for cell in row] for row in rows], colWidths=widths, repeatRows=int(header))
        grid.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.35, colors.HexColor("#D6E0EB")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EBF1F8")),
        ]))
        return grid

    def details(*rows):
        return table([(label, value) for label, value in rows if value not in ("", None)], [135, 365])

    story = [para(institute["name"], title)]
    for value in (institute.get("tagline"), institute.get("address"), institute.get("phone"), institute.get("email")):
        if value:
            story.append(para(value))
    story.append(Spacer(1, 18))
    if kind == "receipt":
        payment, student, slot = data["payment"], data["student"], data["time_slot"]
        story.extend([
            para(f"{institute.get('receipt_heading') or 'Fee Receipt'} · {data['receipt_no']}", heading),
            details(("Student", f"{student['name']} ({student['code']})"), ("Guardian", student.get("guardian")),
                    ("Course", data["course"]["name"]), ("Course subtypes", data.get("course_subtype")),
                    ("Batch", f"{slot['name']} · {slot['timing']}"), ("Joining date", data.get("joining_date")),
                    ("Course expiry", data.get("course_expiry_date")), ("Issued", data["issued_at"][:10])),
            Spacer(1, 12),
            details(("Received (INR)", payment["amount"]), ("Amount in words", data["amount_in_words"]),
                    ("Payment method", payment.get("mode_label") or payment.get("mode")),
                    ("Payment reference", payment.get("reference")), ("Collected by", payment.get("collected_by")),
                    ("Course fee (INR)", data["net_fee"]), ("Previous payments (INR)", data["previous_paid"]),
                    ("Paid to date (INR)", data["total_paid"]), ("Balance (INR)", data["balance"]),
                    ("Next payment date", data.get("next_payment_date"))),
        ])
        if data.get("installments"):
            story.extend([Spacer(1, 12), para("Installment schedule", heading),
                          table([("Installment", "Due date", "Amount (INR)")] + [
                              (row["no"], row["due_date"], row["amount"]) for row in data["installments"]
                          ], [130, 180, 190], header=True)])
        footer = institute.get("receipt_footer")
    else:
        payment = data["payment"]
        story.extend([
            para(f"Paid Service Bill · {data['code']}", heading),
            details(("Customer", f"{data['customer']['name']} ({data['customer']['code']})"),
                    ("Service job", data["job"]["code"]), ("Paid date", local_date(data["paid_at"]).isoformat()),
                    ("Payment method", payment["mode_label"]), ("Payment reference", payment.get("reference"))),
            Spacer(1, 12),
            table([("Service", "Quantity", "Rate (INR)", "Amount (INR)")] + [
                (line["name"], line["quantity"], line["rate"], line["line_amount"]) for line in data["items"]
            ], [235, 65, 100, 100], header=True),
            Spacer(1, 12),
            details(("Subtotal (INR)", data["subtotal"]), ("Discount (INR)", data["discount"]),
                    ("Total paid (INR)", data["grand_total"]), ("Amount in words", data["amount_in_words"])),
        ])
        footer = institute.get("bill_footer")
    if footer:
        story.extend([Spacer(1, 12), para(footer)])
    file = BytesIO()
    SimpleDocTemplate(file, pagesize=A4, rightMargin=40, leftMargin=40, title="IMS " + kind, author=institute["name"]).build(story)
    return file.getvalue()
