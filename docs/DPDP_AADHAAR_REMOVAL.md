# Aadhaar removal (DPDP data minimisation): runbook

Branch `dhruvank-dpdp-aadhaar-removal`. Code removal: 25 Nov 2026. Final removal and safeguards: 26 Nov 2026.
Owner: Dhruvank (QA/security). Supabase changes are applied by Pranav through the normal deployment process.
Tested on synthetic data only. No real Aadhaar number appears in this file, the tests, the scripts or their output.

## 1. Decision

IMS does not collect, store or retain anyone's personal Aadhaar information (team instruction, 26 Nov 2026; no separate
client approval needed for this cleanup).

- IMS has no business need for Aadhaar. Admission, enquiries, fees and service jobs work with name, guardian name,
  date of birth, mobile and address.
- No other identity document replaces it, and nothing new becomes mandatory.
- "Udyog Aadhaar" is an MSME business registration, not a person's Aadhaar, and stays allowed as a document type.

Supabase status checked by the team before the migration: the six columns hold zero non-null values, and the document
metadata tables hold zero Aadhaar records.

## 2. What changed in the code

| Area | Change |
|---|---|
| API input | Every request model refuses any field named like Aadhaar (`aadhaar`, `aadhar`, `adhaar`, `adhar`, `uidai`, any case or suffix). The answer is `422 aadhaar_not_collected`. The value is never stored, echoed back or logged. |
| API output | No Aadhaar field in any response. The two reveal endpoints are removed (404). |
| Search | Name, guardian, Student ID and mobile only. |
| Admission | Nothing from an enquiry's old Aadhaar is copied (the columns are gone). |
| Documents | Uploads typed or named as Aadhaar or UIDAI are refused with `AADHAAR_NOT_COLLECTED` before the file is read or saved. Nothing is written to storage, and the file name is not logged. "Udyog Aadhaar" is allowed. |
| Models | No Aadhaar columns. `tests/test_aadhaar_final.py` fails if one is ever added back. |
| Crypto | The Aadhaar hashing, last-4 masking and Aadhaar decryption are removed. Documents are still encrypted with `DATA_ENC_KEY`. The old variable name `AADHAAR_ENC_KEY` is still read, so a server configured with it can still open its encrypted documents; it is the document key, not an Aadhaar feature. `AADHAAR_HASH_KEY` is unused and can be deleted from env files. |
| Frontend | No Aadhaar field, line, reveal button, hint or document suggestion on any screen. |
| Reports, exports, PDFs | All 25 Excel exports and the receipt and bill print data contain no Aadhaar field or number. |

## 3. Database and storage: order of work

| Step | What | Who |
|---|---|---|
| 0 | Deploy a backend built from `dhruvank-dpdp-aadhaar-removal`. Older builds (for example `integration/mysql84-dhruvank` @ 7ec0c92) still read the Aadhaar columns and fail once they are dropped. | Pranav |
| 1 | Backup: `python scripts/backup_db.py --env-file <env> backup --out <dir>`, then `... verify <file>` | Pranav |
| 2 | `psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f sql/2026-11-26_aadhaar_final_removal.sql` (or run the whole file in the Supabase SQL editor) | Pranav |
| 3 | `sql/2026-11-25_aadhaar_inventory_READ_ONLY.sql`: must show "columns removed - none stored" and 0 Aadhaar documents | Pranav |
| 4 | On the machine that holds `FILE_STORAGE_ROOT` for the live API: `python scripts/aadhaar_documents.py --env-file <env> inventory`, then `delete` (dry run), then `delete --confirm` | Pranav |
| 5 | Backup expiry: set `BACKUP_KEEP_DAYS` (default 30) and run `backup_db.py prune --out <dir>` once; `backup` prunes automatically afterwards | Pranav |

**What the migration does.** It runs as one transaction: either everything is done or nothing is.
- **Preflight.** It stops with "Stopped, nothing changed" if any of the six columns still holds a value, or if a view, policy, or an index or constraint that also covers another column depends on them. Values are never printed.
- **Removal.** It drops the 25 Nov guard triggers if present, then the six columns (RESTRICT: never CASCADE). Indexes and constraints that exist only for them go with them, and are listed first.
- **Safeguards it installs:**
  - a document trigger (Aadhaar or UIDAI type or file name refused; Udyog allowed);
  - an event trigger that refuses any new Aadhaar-named column in `public`. If the role cannot create event triggers, it prints a NOTICE and continues; the app tests still guard the models.
- **Audit.** One audit entry, holding column names only.
- **Repeat runs.** Safe to run twice; the second run drops nothing and adds no audit entry.

**What it does not touch.** Every other table, row, column, index, constraint, trigger, RLS policy and grant. On the
rehearsal copy, all 39 tables' data and 794 schema lines were identical before and after.

## 4. Storage, temporary files, exports and backups

- **Document storage** (`FILE_STORAGE_ROOT`): `scripts/aadhaar_documents.py` finds Aadhaar documents by metadata,
  including ones already deleted in the app. It also finds orphan files: files on disk that no `files` row points to,
  which the app can never show.
  - `delete --confirm` overwrites and removes those files.
  - It scrubs the old file name, type and checksum from the metadata, keeping the rows marked deleted so job history stays consistent.
  - It writes one audit entry with counts only.
- **Temporary uploads:** the API reads uploads in memory. FastAPI's temporary upload buffer is deleted when the request
  ends. A refused Aadhaar upload is rejected before anything is written to storage (tested: storage file count unchanged).
- **Exports and PDFs:** built in memory, never stored on the server. Copies people downloaded earlier (laptops, phones,
  WhatsApp) are outside IMS; staff should delete any that show Aadhaar.
- **App backups** (`backup_db.py`): encrypted, and kept for `BACKUP_KEEP_DAYS` days (default 30, at most 30 files). The newest
  backup is never deleted. Backups taken before the migration contain the empty columns only. Backups from before 25 Nov
  could still hold Aadhaar values; they expire under this rule.
- **Supabase's own backups and point-in-time recovery:** kept for the plan's retention period and then expire on their own;
  they cannot be edited. Note the migration date: after the retention period, no Supabase backup holds the old columns.

## 5. Outside IMS (staff)

- Paper photocopies of Aadhaar cards in admission files: return or shred them.
- The shop's own services ("Aadhaar Update" in the service list, "Aadhar Card Print" in the rate card printed on bills) are
  services sold at the counter. IMS stores only the service name and price, never the customer's Aadhaar. Staff must not
  type Aadhaar numbers into job notes, and must return the original documents.

## 6. Leftover mentions of "Aadhaar" in the code (classified)

| Where | Why it stays |
|---|---|
| `common.py` `AADHAAR_FIELD`, `In._no_aadhaar`; `jobs.py` `mentions_aadhaar`, `refuse_aadhaar_document` | The refusal itself |
| `config.py` alias `aadhaar_enc_key` | Old name of the document key, so existing servers can still decrypt documents |
| `common.py` `_CATEGORY_RULES`, `admin.py` filter, `Admin.tsx` tone | Historical audit entries (`AADHAAR_REVEALED`, `AADHAAR_COLUMNS_DROPPED`, ...) still show under Security. The audit log is append-only and is not edited. |
| `PrintDocs.tsx` "Aadhar Card Print", "Udyog Adhar" | Rate-card text of services the shop sells, not data |
| `sql/2026-11-26_*`, `sql/2026-11-25_*inventory*`, `scripts/aadhaar_documents.py`, tests | Removal tooling and its tests |

## 7. Tests (26 Nov 2026)

- **Backend `pytest`:** 156 passed, 1 skipped, 5 xfailed (known, unrelated).
- **Migration rehearsal** on a Supabase-like copy with the 25 Nov guard and two Aadhaar indexes (`secprobe/final_mig_run.sh`):
  - backup verified;
  - 6 columns and 2 indexes dropped;
  - everything else identical;
  - second run a no-op;
  - inventory clean.
- **Migration safety and guard tests** (`secprobe/final_mig_tests.sh`): 19/19.
- **Document cleanup** on the copy: 6 Aadhaar documents and 1 orphan file removed, metadata scrubbed, the other document untouched, inventory 0/0 afterwards.
- **API regression** on the migrated copy (`secprobe/final_api.py`): 31/31.
- **Browser:** Aadhaar walk-through 15/15; UI admission saved; 29 screens open with no errors and 0 CSP violations.
- **Frontend:** `tsc` clean, `npm test` 6/6, build OK.

## 8. Rollback

There is no data to restore: the columns were empty. If the old code must be run again, restore the step 1 backup into a
spare database, or re-add the six empty columns by hand. Re-adding them needs the event trigger dropped first, which is
deliberate.
