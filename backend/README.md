# IMS API (FastAPI)

Business backend for the Updaate Computers IMS React UI. It replaces `src/data/store.ts` with real REST calls.
Dev DB: Supabase PostgreSQL (36 approved tables). Production target: MySQL.

## Run

```bash
cd backend
uv venv -p 3.11 .venv && uv pip install -p .venv/Scripts/python.exe -e ".[dev]"
cp .env.example .env            # fill DATABASE_URL, AADHAAR_* keys
.venv/Scripts/python -m uvicorn app.main:app --reload     # http://localhost:8000/docs
.venv/Scripts/python -m pytest -p no:logging               # local throwaway Postgres, never the shared DB
```

Bootstrap (run only when the team agrees; it writes to the database it points at):

```bash
.venv/Scripts/python -m app.cli seed                          # 36 permission codes + 11 expense categories
.venv/Scripts/python -m app.cli create-admin admin "Full Name"  # the one Admin (password prompted)
```

`IMS_LIVE_DATABASE_URL=<supabase url> pytest tests/test_schema_drift.py` compares `app/models.py` with the live schema (read-only).

## Layout

```
app/
  main.py        app, CORS, request-ID logging, health
  config.py      env settings
  db.py          engine + session (services commit explicitly, one transaction per request)
  errors.py      {"error": {code, message, field_errors}} + DB constraint -> business error mapping
  models.py      ORM mirror of the 36 approved tables (no create_all against shared DBs)
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
| 16 | Validation, API, concurrency, reconciliation tests | `tests/` (35 tests) | - |

## Rules worth knowing

- **Money**: `Decimal` end to end, sent as `"1500.00"` strings. Clients send business input only; unknown fields return 422.
- **Income ledger**: valid `student_payments` (by `received_at`) + `service_bills` with status `Paid` (by `paid_at`). Expenses: not soft-deleted, by `expense_date`. Receipts are never summed.
- **Installments**: split mirrors `admitStudent` in `store.ts` (multiples of 50, last row takes the rest, month-end clamping). Allocation is FIFO and rebuilt after every payment or reversal, so `paid_amount` always equals valid payments.
- **Idempotency**: `Idempotency-Key` header on fee payments, admissions and bill payments. A replay returns the original with `"replayed": true`.
- **Dates**: stored UTC, day boundaries in `INSTITUTE_TIMEZONE`.
- **Never claimed**: WhatsApp is "opened" only. There is no PDF endpoint (browser print). Backup is history only (no fake trigger). Service cost/profit returns `null` with `pending_cost_rule`.

## Requests for Pranav (schema; nothing was changed by this backend)

1. `student_installments.installment_no > 0` vs the UI's row 0 "Admission". Rows are stored as `display_no + 1` (`ledger.INSTALLMENT_NO_OFFSET`). Relaxing the check to `>= 0` removes the offset.
2. `service_job_documents` has no sensitive flag. The backend mirrors the UI rule (Aadhaar / PAN / bank / Form 16, not photos). An `is_sensitive` column would make it explicit.
3. Case-insensitive uniqueness for `course_subtypes(course_id, lower(name))` and `expense_categories(lower(name))`. It's checked in code today; a unique index closes the race.
4. MySQL equivalents are needed for the partial index `one_non_cancelled_bill_per_job`, the account-limit trigger and `jsonb`.
5. RLS currently allows only the two developer roles. The deployed API needs its own service role and policy.
6. Seed decisions: `number_sequences` start values (receipts at 01201 and bills at 0301 like the demo, or 1?). Missing rows start at 1. Institute details are blank.

## Requests for Dhruvank (security)

1. `security.py` is a working seam, not the final implementation: scrypt hashes, opaque bearer tokens hashed into `user_sessions`, and a 5-try / 15-minute lockout. Replace its internals while keeping `get_current_user`, `require`, `require_any`, `require_admin` and `CurrentUser.can`.
2. Agree the Aadhaar Fernet key and HMAC key (`AADHAAR_ENC_KEY`, `AADHAAR_HASH_KEY`). Data written with one key can't be read with another.
3. `payments.delete_or_reverse` is treated as Admin-only, per the DB handoff (the UI lists it as delegable).
4. No idle-timeout yet: sessions expire after `SESSION_HOURS`. `last_activity_at` is set at login only.

## Still open (not invented)

- Refund rule when a paid bill is cancelled. Its replacement bill can't collect money until this is decided (`PREVIOUS_PAYMENT_UNRESOLVED`).
- Service cost rule (Service Profit report). Student photo upload. Backup destination, encryption, schedule and restore policy.
- Re-activating Completed/Left students and course transfers are not exposed until the product owner approves them.
- The React app still uses `store.ts`. Wiring it to these endpoints is the frontend integration step.
