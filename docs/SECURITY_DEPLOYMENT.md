# IMS security: go-live checklist and operations (23 Nov 2026)

What the 23 Nov security patches changed, and the steps that must be done outside the code. The findings come from the
"IMS Security Review — 23 Nov 2026" (SEC-01 … SEC-15).

## 1. What changed in the app

| ID | Change | Where |
| --- | --- | --- |
| SEC-03 | No hard lock. From the 5th wrong password each try waits longer: 30 s, 1, 2, 4, 8 min, at most 15 min. The 20-failures-per-address limit only stops names that already failed from that address, and a successful sign-in or recovery clears that name's earlier failures. | `backend/app/security.py` |
| SEC-04 | Not done by decision (23 Nov): sign-in stays password-only, no two-step code. | — |
| Forgotten password | Every account gets a one-time recovery key, shown once after sign-in. Sign-in page → "Forgot password?" → username + key + new password; a new key is shown at once. It also works during a wait. No key: the Admin resets staff; server command for the Admin. | `security.py`, `pages/Login.tsx`, `pages/SecuritySetup.tsx`, `components/RecoveryKey.tsx` |
| SEC-05 | New-staff and reset passwords are temporary: the person must choose their own before anything else works. | `security.py`, `routers/admin.py`, `pages/SecuritySetup.tsx` |
| SEC-06 | Uploaded documents are encrypted on disk (Fernet, `DATA_ENC_KEY`; the old name `AADHAAR_ENC_KEY` is still read) and checked against their checksum when opened. Older plain files still open. | `routers/jobs.py` |
| SEC-07 | Content-Security-Policy in the built `index.html`; `npm run preview` sends it as a header with the other security headers. | `frontend/vite.config.ts` |
| SEC-08 / SEC-13 | `APP_ENV=production` refuses to start with unsafe settings (http origin, docs on, weak hashing, database TLS without certificate check). `python -m app.cli check-production` lists them. | `backend/app/config.py` |
| SEC-09 / SEC-10 | Exact package versions with hashes: `backend/requirements.lock`, `backend/requirements-dev.lock`. `opentelemetry-api` 1.45.2. | `backend/` |
| SEC-11 | Per-user limits per minute: search 60, Excel export 30, document download 60, upload 30, WhatsApp send 20. | `backend/app/ratelimit.py` |
| SEC-12 | Password hashing scrypt N=131072 (OWASP); older hashes are upgraded at the next sign-in; at most 2 hashes at once. | `security.py` |
| SEC-14 | Audit log is append-only in the database (UPDATE / DELETE / TRUNCATE refused). | `backend/sql/2026-11-23_security_patches.sql` |
| SEC-02 | Encrypted backup / verify / restore script (database + documents). | `backend/scripts/backup_db.py` |

## 2. Database steps (shared Supabase: project owner, after approval)

Run in the Supabase SQL editor, in this order. Each file says what it changes; none deletes data.

1. `backend/sql/2026-11-23_check_data_api_access.sql` — read-only. Save the result (the "before" picture).
2. `backend/sql/2026-11-23_security_patches.sql` — **must run before the new backend starts** (2 new `users` columns).
3. `backend/sql/2026-11-23_lock_down_data_api.sql` — RLS on every table, browser roles removed, role `ims_api` created.
4. Set the `ims_api` password by hand (never in a file or chat): `ALTER ROLE ims_api WITH LOGIN PASSWORD '…';`
5. Run step 1 again: parts 1–3 must return no rows.
6. Point the live API's `DATABASE_URL` at `ims_api.<project-ref>` (session pooler) with
   `?sslmode=verify-full&sslrootcert=<path to the Supabase CA certificate>` (download it from Project Settings → Database).
7. Dashboard → Database → Backups: confirm daily backups are on (point-in-time recovery if the plan has it).

On a laptop database only step 2 is needed: `python C:\Projects\ims-local\apply_sql.py backend\sql\2026-11-23_security_patches.sql`.
`2026-11-23_laptop_only_drop_two_step_columns.sql` removes the three columns the first (two-step) version added on laptops;
never send it to Supabase, where those columns never existed.

## 3. Live server settings (SEC-08)

```
APP_ENV=production
FRONTEND_ORIGIN=https://<the real web address>
EXPOSE_DOCS=false
DATA_ENC_KEY=<from the host's secret store>         # same key the documents were written with (was AADHAAR_ENC_KEY)
DATABASE_URL=postgresql+psycopg://ims_api.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ims/supabase-ca.crt
FILE_STORAGE_ROOT=<private folder on an encrypted disk, included in backups>
```

Start behind an HTTPS reverse proxy, so the sign-in limits see each user's real address (SEC-03):

```
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips 127.0.0.1
```

Before the first start: `python -m app.cli check-production` must print "Production settings OK."

Install packages only from the lock: `pip install --require-hashes -r requirements.lock` then `pip install --no-deps -e .`

## 4. Web page headers on the frontend host (SEC-07)

The built `index.html` already carries the Content-Security-Policy. Add these as HTTP headers on the host as well
(`frame-ancestors` and HSTS only work as headers). Replace `https://api.example.in` with the API's address.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.example.in; frame-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

nginx example: one `add_header <name> "<value>" always;` line per header inside the site's `server { … }` block.
Build the frontend with the real API address: `VITE_API_URL=https://api.example.in/api/v1 npm run build`.

## 5. Backups (SEC-02)

Supabase's own daily backups are the first line. `backend/scripts/backup_db.py` makes a second, encrypted copy that is
kept off Supabase, and includes the documents folder.

1. Once: `python scripts\backup_db.py new-key` → save the key in a password manager (not next to the backups).
2. Each night (Windows Task Scheduler, or cron on the server): set `BACKUP_ENC_KEY`, then
   `python scripts\backup_db.py --env-file <api env file> backup --out D:\IMS-Backups` (keeps the newest 30).
3. Every month: `verify` the newest file, and once a quarter `restore` it into a **spare** database and open the app
   against it. The script refuses to restore over the database in `DATABASE_URL`.

`pg_dump` must be the same or a newer major version than the server (set `PG_BIN` to its folder).

## 6. Forgotten passwords (recovery keys for every account)

- Every account (Admin and Staff) gets a one-time **recovery key**, shown once right after sign-in: new staff see it
  after choosing their own password; existing accounts see it once at their next sign-in. "I have saved it" must be
  ticked to continue. Only a hash is stored.
- Forgot the password: sign-in page → **Forgot password?** → username + recovery key + new password. The old key stops
  working and a **new key is shown at once** (save it before going back to sign-in).
- Lost the key too: staff ask the Admin (Staff → Reset password; this also cancels their old key, and a new one is shown
  at their next sign-in). Admin: on the server, `python -m app.cli reset-password <username>`.
- Account menu → **Recovery key** makes a new key at any time (the old one stops working).
- The Staff list shows "No recovery key yet" for accounts that haven't signed in since.
- Rename the `admin` username on the live database to something less guessable (SEC-03), since sign-in is password-only.

## 7. Regular checks

- `security-check.ps1` (repo root) before every push: tests, `pip-audit` on the lock, `npm audit`.
- After go-live: repeat the review's checks against the live address; an outside penetration test once a year.
