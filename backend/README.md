# IMS API (FastAPI)

Business backend for the Updaate Computers IMS React UI. The React app in `frontend/` calls these endpoints; the old in-memory demo store (`store.ts`) has been removed.
Development and client testing use the shared Supabase PostgreSQL project `tiusjvbrbjsxfmvhursm` (38 application tables).

## Run

```bash
cd backend
uv venv -p 3.11 .venv && uv pip install -p .venv/Scripts/python.exe -e ".[dev]"
# without uv:  py -3.11 -m venv .venv  &&  .venv/Scripts/python -m pip install -e ".[dev]"
cp .env.example .env            # fill DATABASE_URL, AADHAAR_* keys
.venv/Scripts/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
.venv/Scripts/python -m pytest -p no:logging               # local throwaway Postgres, never the shared DB
```

For the current local integration, use the project owner's authorized Supabase session-pooler connection in
`backend/.env`. For the `postgres` database account, the pooler username is `postgres.tiusjvbrbjsxfmvhursm`.
Copy the host and port from the project's **Connect → Session pooler** dialog and use `sslmode=require`.
Percent-encode reserved characters in the database password before putting it in the URL.
Run Uvicorn from `backend/` so the settings loader finds that file. An exported `DATABASE_URL` takes precedence.
Check `http://127.0.0.1:8000/api/v1/health/db` before signing in. If it returns 503, check the backend log for the
connection failure category. A database password rejection means the pooler could not establish the API's connection.

First-time setup for a new database only, with authorization to write to that database:

```bash
.venv/Scripts/python -m app.cli seed                               # permissions, expense categories, institute details from the templates
.venv/Scripts/python -m app.cli create-admin admin "Administrator"   # the single Admin; password is prompted
```

The database allows exactly **1 Admin + 4 Staff** (trigger on `users`). The Admin creates staff under Administration -> Staff;
a fifth staff account returns `409 STAFF_ACCOUNT_LIMIT_REACHED`, and disabled staff still hold their slot.

## Production checklist

- `APP_ENV=production` (docs off, HSTS on). Startup refuses to run without `AADHAAR_ENC_KEY` / `AADHAAR_HASH_KEY`.
- `FRONTEND_ORIGIN` = the real web origin(s), comma-separated. Bearer tokens only, no cookies.
- Use a dedicated application database role for the hosted client-facing environment. Grant the DML, sequence and
  function privileges the API needs and matching RLS policies. Reserve schema changes for a separate migration role.
- Run behind HTTPS: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --proxy-headers --forwarded-allow-ips <proxy ip>`.
- Sessions: 12 h absolute, 30 min idle (`SESSION_HOURS`, `SESSION_IDLE_MINUTES`); 5 wrong passwords lock an account for 15 min;
  20 failures from one IP in 15 min block that IP. Users change their own password from the account menu.
- Every response carries security headers and `Cache-Control: no-store` on the API; logs never contain bodies, tokens or Aadhaar.
- `FILE_STORAGE_ROOT` must be a private, backed-up folder (service job documents).

`IMS_LIVE_DATABASE_URL=<supabase url> pytest tests/test_schema_drift.py` compares `app/models.py` with the live schema (read-only).

## Automatic WhatsApp PDFs

Service bills save the service login username. Bill Desk keeps the optional password in memory for the open bill.
Use **Include Service Login Details in PDF** for print or download, or select it separately in the WhatsApp sharing
dialog. Re-enter the password after reopening the bill. Automatic WhatsApp delivery receives the password only in the
authorized delivery request and uses it to render that PDF. Bill records and delivery logs contain no password.

On a browser that supports sharing PDF files, **Share PDF on WhatsApp** passes the generated file to the device's share
window. The operator chooses WhatsApp and the contact and presses Send. The browser records the handoff as opened.
**Open Chat & Save PDF** opens the registered number's chat and downloads the PDF for manual attachment when a device share
target is unavailable. The [Web Share standard](https://www.w3.org/TR/web-share/) leaves target selection to the device and
[WhatsApp Click to Chat](https://faq.whatsapp.com/5913398998672934) accepts a number and optional prefilled text.

Automatic delivery uses the registered number and sends the PDF without a device share window or contact search. Enable it
after the delivery-table migration is reviewed and applied and the following server-side settings are ready.

| Setting | Value |
|---|---|
| `WHATSAPP_ENABLED` | `true` after setup and authorization |
| `WHATSAPP_ACCESS_TOKEN` | Server-side Meta access token with `whatsapp_business_messaging` for the sending number |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API business phone number ID |
| `WHATSAPP_GRAPH_VERSION` | Supported Graph API version configured for the Meta app, including the `v` prefix |
| `WHATSAPP_APP_SECRET` | Meta app secret for callback signature validation |
| `WHATSAPP_VERIFY_TOKEN` | Private token chosen for the webhook challenge |
| `WHATSAPP_RECEIPT_TEMPLATE`, `WHATSAPP_BILL_TEMPLATE` | Approved utility templates with a document header and static body text |
| `WHATSAPP_TEMPLATE_LANGUAGE` | The approved language code shared by both templates |
| `WHATSAPP_PDF_FONT` | Server path to a TrueType font covering document text. Configure a Devanagari-capable font for Marathi documents. |

Subscribe the WhatsApp Business Account to the `messages` webhook at the API’s HTTPS URL ending in
`/api/v1/webhooks/whatsapp`. Remove query strings from proxy access logs because Meta sends the verification token in the
challenge URL. The migration grants table access to its owner. For a dedicated runtime database role, grant only SELECT,
INSERT and UPDATE with matching RLS policies for that role before activation.

An authorized operator confirms opt-in for the displayed registered number for every attempt. The backend rechecks that number
and document eligibility, renders the receipt snapshot or paid bill as a PDF in memory, and uploads it to Meta using authenticated
media upload. IMS uses the approved document-header template for every automatic send, so sending also works outside the
24-hour customer-service window. Only signed callbacks advance the provider status to sent, delivered or read.

An explicit failure permits a new attempt with confirmed consent. If a send loses its response, the attempt stays pending
until a signed callback identifies its outcome. Check the attempt against Meta before any manual resend to avoid double delivery.

- [Meta Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview)
- [Meta media template request example](https://www.postman.com/meta/whatsapp-business-platform/request/2qbotrb/send-message-template-media)
- [Meta message webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)

For a disposable PostgreSQL back-end benchmark, run `python -m pytest -q -s tests/benchmark_ims.py` from this directory.
The harness prints medians, p90, SQL statement counts and response bytes. Use request logs to compare wall time with database
and password/PDF/provider time using the request ID.

## Layout

```
app/
  main.py        app, CORS, request-ID logging, health
  config.py      env settings
  db.py          engine + session (services commit explicitly, one transaction per request)
  errors.py      {"error": {code, message, field_errors}} + DB constraint -> business error mapping
  models.py      ORM mirror of the 38 application tables
  security.py    SECURITY SEAM: sessions, login, RBAC (get_current_user / require / require_admin)
  common.py      validators, money (Decimal, 2dp strings), dates (institute TZ), pagination, audit, numbering, Aadhaar crypto
  ledger.py      the single money source: FIFO allocation, fee state, totals, daily/monthly series
  routers/       academics, enquiries, students, fees, services, jobs, bills, expenses, finance, dashboard, reports, admin
```

Routers hold both the route and its business rules; there is no separate repository layer (one consumer per query).

## The 16 action points

| # | Action point | Where | Tests |
|---|---|---|---|
| 1 | Admission validation, mandatory fields, enquiry -> student | `students.admit`, `POST /enquiries/{code}/convert`, `POST /students` | test_admissions |
| 2 | Separate student WhatsApp number | `students.whatsapp_number` (defaults to mobile) | test_admissions |
| 3 | Server-side IDs in approved formats | `common.next_code` (row-locked `number_sequences`) | test_admissions, test_fees |
| 4 | 1 Admin + 4 Staff | DB trigger + `409 STAFF_ACCOUNT_LIMIT_REACHED`; `/staff` returns `account_limit` | test_auth_staff (incl. 6-thread race) |
| 5 | Admin-only reversal + Aadhaar reveal | `require_admin` on reverse and `/aadhaar`; reveal audited | test_fees, test_admissions |
| 6 | Paid bill lock, audited cancel + replacement | `BILL_LOCKED`, `/cancel`, new bill after cancel (`replaces`) | test_services |
| 7 | created_by / paid_by / paid_at | `service_bills`; "bills I closed" uses `paid_by` | test_services, test_finance_reports |
| 8 | Immutable receipt snapshots | `fee_receipts.snapshot` + `next_payment_date_snapshot` | test_fees |
| 9 | Global search | `GET /search?q=` (groups filtered by permission) | test_finance_reports |
| 10 | Sidebar summary + notifications | `GET /meta/sidebar`, `GET /meta/notifications` | test_finance_reports |
| 11 | Student edit / archive / mark left / change batch | `PATCH /students/{code}`, `/archive`, `/mark-left`, `/mark-completed`, `/change-time-slot` | test_admissions |
| 12 | Missing course, expense, service, category ops | full CRUD + activate/deactivate in academics, expenses, services | all |
| 13 | 25 reports + exports | `GET /reports`, `/reports/{slug}`, `/reports/{slug}/export.xlsx` | test_finance_reports |
| 14 | Financial integrity | `ledger.py`; row locks; idempotency keys; reconciliation tests | test_fees, test_finance_reports |
| 15 | Auth / sessions / RBAC (Dhruvank) | `security.py` seam on `users`, `user_sessions`, `login_attempts` | test_auth_staff |
| 16 | Validation, API, concurrency, reconciliation tests | `tests/` (67 tests incl. QA regressions and sprint acceptance tests; the live-schema test is skipped without `IMS_LIVE_DATABASE_URL`) | - |

## Rules worth knowing

- **Money**: `Decimal` end to end, sent as `"1500.00"` strings. Clients send business input only; unknown fields return 422.
- **Income ledger**: valid `student_payments` (by `received_at`) + `service_bills` with status `Paid` (by `paid_at`). Expenses: not soft-deleted, by `expense_date`. Receipts are never summed.
- **Installments**: split keeps the rule of the original UI demo (`admitStudent`) (multiples of 50, last row takes the rest, month-end clamping). Allocation is FIFO and rebuilt after every payment or reversal, so `paid_amount` always equals valid payments.
- **Idempotency**: `Idempotency-Key` header on fee payments, admissions and bill payments. A replay returns the original with `"replayed": true`.
- **Dates**: stored UTC, day boundaries in `INSTITUTE_TIMEZONE`.
- Manual WhatsApp sharing records a device share handoff or a chat open. Automatic delivery has its own delivery history and signed statuses. The browser
  still renders the printable A5 PDFs. Backup shows run history. Service cost and profit report `pending_cost_rule` while the cost rule is pending.

## Requests for Pranav (schema; nothing was changed by this backend)

1. `student_installments.installment_no > 0` vs the UI's row 0 "Admission". Rows are stored as `display_no + 1` (`ledger.INSTALLMENT_NO_OFFSET`). Relaxing the check to `>= 0` removes the offset.
2. `service_job_documents` has no sensitive flag. The backend mirrors the UI rule (Aadhaar / PAN / bank / Form 16, not photos). An `is_sensitive` column would make it explicit.
3. Case-insensitive uniqueness for `course_subtypes(course_id, lower(name))` and `expense_categories(lower(name))`. It's checked in code today; a unique index closes the race.
4. MySQL equivalents are needed for the partial index `one_non_cancelled_bill_per_job`, the account-limit trigger and `jsonb`.
5. RLS currently allows only the two developer roles. The deployed API needs its own service role and policy.
6. Seed decisions: `number_sequences` start values (receipts at 01201 and bills at 0301 like the demo, or 1?). Missing rows start at 1. Institute details are seeded from the receipt template by `app.cli seed` and editable in Settings.

## Requests for Dhruvank (security)

1. `security.py` is a working seam, not the final implementation: scrypt hashes, opaque bearer tokens hashed into `user_sessions`, and a 5-try / 15-minute lockout. Replace its internals while keeping `get_current_user`, `require`, `require_any`, `require_admin` and `CurrentUser.can`.
2. Agree the Aadhaar Fernet key and HMAC key (`AADHAAR_ENC_KEY`, `AADHAAR_HASH_KEY`). Data written with one key can't be read with another.
3. `payments.delete_or_reverse` is treated as Admin-only, per the DB handoff (the UI lists it as delegable).
4. Done: 30-minute idle timeout (`SESSION_IDLE_MINUTES`, via `last_activity_at`). Lockout race, password policy and username-timing fixes (QA-04/16/17) are on branch `dhruvank`.

## Still open (not invented)

- Refund rule when a paid bill is cancelled. Its replacement bill can't collect money until this is decided (`PREVIOUS_PAYMENT_UNRESOLVED`).
- Service cost rule (Service Profit report). Student photo upload. Backup destination, encryption, schedule and restore policy.
- Re-activating Completed/Left students and course transfers are not exposed until the product owner approves them.
- Verification against the shared Supabase database (schema drift test, RLS/service role) is pending database access.
