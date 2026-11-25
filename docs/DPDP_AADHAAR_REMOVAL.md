# Aadhaar removal (DPDP data minimisation): runbook

Branch: `dpdp-aadhaar-removal`, based on `dhruvank-security-patches` (56d37cf). Prepared 25 Nov 2026 by Dhruvank (QA/security).
Tested on synthetic data only. No real Aadhaar number appears in this file, the tests, the scripts or their output.

## 1. Decision and reason

IMS no longer collects, stores, shows, searches or reveals Aadhaar numbers or Aadhaar card copies.

- IMS has no business need for Aadhaar. Admission, enquiries, fees and service jobs work with name, guardian name, date
  of birth, mobile and address.
- DPDP Act 2023 s.6(1) / s.8(7) and the data-minimisation principle say: collect only what the purpose needs, and erase it when the purpose is served.
- The UIDAI rules for an organisation that stores Aadhaar numbers (Aadhaar Data Vault, reference keys, HSM-held keys)
  are heavier than anything IMS needs. The simplest compliant position is not to hold Aadhaar at all.
- No replacement identity document is required. Nothing else is made mandatory in its place.

## 2. What changed in the code (done, tested)

| Area | Change |
|---|---|
| API input | Every request model refuses any field whose name looks like Aadhaar (any spelling: `aadhaar`, `aadhar`, `adhaar`, `adhar`, `uidai`...) with `422 aadhaar_not_collected` and the message "Aadhaar is no longer collected by IMS. Remove this field." The value is never echoed back. |
| API output | `aadhaar_masked` was removed from students, enquiries and lists. `GET /students/{code}/aadhaar` and `GET /enquiries/{code}/aadhaar` were removed (404). |
| Search | Student / global search no longer matches Aadhaar (name, guardian, Student ID, mobile only). |
| Admission | An enquiry's old Aadhaar value is never copied to the student. |
| Documents | Uploads typed or named as Aadhaar are refused with `AADHAAR_NOT_COLLECTED`. "Udyog Aadhaar" (MSME registration) is still allowed. Existing documents are untouched until the approved deletion. |
| Models | The six Aadhaar columns are no longer mapped, so the app works before and after they are dropped. |
| Settings | The document key is now `DATA_ENC_KEY`. The old name `AADHAAR_ENC_KEY` is still read, so existing servers need no change. `AADHAAR_HASH_KEY` is no longer used. |
| Frontend | Aadhaar fields were removed from Admission, Enquiries and Student Profile, along with the reveal button, the search placeholders and the "Aadhaar Card" document type suggestion. |
| Rate limits | The "aadhaar" reveal bucket was removed. |

## 3. Database and files: order of work

| Step | File | Kind | Who approves |
|---|---|---|---|
| 1 | `backend/sql/2026-11-25_aadhaar_inventory_READ_ONLY.sql` | Read only. Counts columns, values, documents and audit entries. Prints no values. | Pranav runs it on the shared DB (Dhruvank has no Supabase access). Save the output. |
| 2 | Deploy the app from this branch | Code | Pranav / Devanshu review the PR |
| 3 | `backend/sql/2026-11-25_aadhaar_block_new_values.sql` | Schema only: triggers that refuse NEW Aadhaar values and Aadhaar documents. Clearing an old value is still allowed. Idempotent. | Pranav (shared-DB change) |
| 4 | `python scripts/aadhaar_documents.py --env-file <env> inventory` | Read only. Lists Aadhaar documents by id, job, date and size, never by file name. | Whoever runs the server |
| 5 | Backup: `scripts/backup_db.py backup`, then `verify` | Creates an encrypted backup | Pranav |
| 6 | **Written approval** from Updaate Computers to delete stored Aadhaar data | Business / legal | Client (Data Fiduciary) |
| 7 | `backend/sql/2026-11-25_aadhaar_DELETE_requires_approval.sql` | **Destructive.** Clears values, drops the 6 columns, marks Aadhaar document rows deleted, and writes an audit entry with counts only. Idempotent. | Only after step 6 |
| 8 | `python scripts/aadhaar_documents.py ... delete` (dry run), then `delete --confirm` | **Destructive.** Removes the files from `FILE_STORAGE_ROOT`. | Only after step 6 |
| 9 | Re-run step 1 | Read only. It must show no Aadhaar columns, values or visible documents. | Pranav |
| 10 | Off-database copies (see section 5) | Manual | Client |
| 11 | Destroy the pre-deletion backup after the agreed rollback window (suggested 30 days) | Manual | Client |

Steps 1 to 5 can go ahead now. Steps 7, 8, 10 and 11 wait for step 6.

## 4. Retention: is there a reason to keep the old Aadhaar values?

None was found. No GST, income-tax or education rule requires a private computer institute to keep Aadhaar numbers.
Fee receipts and service bills (the records GST and income tax care about) do not contain Aadhaar and are kept.
Before step 7 the client confirms that no dispute, police request or other legal hold covers these records. If one
does, delete everything except the records under hold, and delete those once the hold ends.

## 5. Places outside the database to check (client / staff)

- **Server document folder:** handled by step 8. Files soft-deleted in the app before today are included.
- **Supabase backups / point-in-time recovery:** the old values age out with the plan's backup retention. Note the date.
- **Laptop copies, pen drives, old Excel exports, WhatsApp chats and email** on office computers and phones.
  Exports never contained full Aadhaar numbers, but staff may have photographed or forwarded card copies.
- **Paper:** photocopies of Aadhaar cards in admission files. Return them or shred them, according to the client's decision.
- **The "Aadhaar Update" / "Aadhar Card Print" services.** These are services the shop sells, not data IMS needs. They stay
  in the service list. Staff must not type Aadhaar numbers into job notes, and must not upload card copies (the upload is
  now refused). Return originals to the customer after the job.

## 6. Leftover mentions of "Aadhaar" in the repository (classified)

| Where | Why it stays |
|---|---|
| `common.py` `AADHAAR_FIELD`, `In._no_aadhaar` | The refusal itself |
| `jobs.py` `mentions_aadhaar`, `refuse_aadhaar_document`, `_SENSITIVE` | The upload refusal. Legacy documents still count as sensitive until they are deleted. |
| `common.py` `_CATEGORY_RULES`, `admin.py` security filter, `Admin.tsx` tone | So historical audit entries (`AADHAAR_REVEALED`, the new `AADHAAR_DATA_DELETED`) still show under Security |
| `models.py`, `students.py`, `config.py` comments | Explain the removal and the key alias |
| `PrintDocs.tsx` "Aadhar Card Print", "Udyog Adhar" | Names of services the shop sells (rate card). Client decision. |
| `IMPLEMENTATION_REPORT.md`, `docs/IMS_PERFORMANCE_WHATSAPP.md` | Historical reports, left as written |
| `backend/sql/2026-11-25_*`, `scripts/aadhaar_documents.py`, tests | The removal tooling and its tests |
| Older migrations in `backend/sql/` and Supabase migrations | Historical. The delete migration supersedes them. |

## 7. Acceptance tests

Automated (`pytest`): `test_aadhaar_is_no_longer_collected_anywhere`, `test_d3_03_no_aadhaar_stored_shown_or_revealed`,
the upload refusal and Udyog exception in `test_services.py`, and `test_old_aadhaar_key_name_still_works_for_documents`.
Result on 25 Nov 2026: 150 passed, 1 skipped, 5 xfailed (known, unrelated).

Manual (browser, synthetic data):
1. New Enquiry, Admission and Edit Student show no Aadhaar field. Each form saves.
2. Student Profile shows no Aadhaar line and no reveal button.
3. Searching by a 12-digit number returns nothing new. Searching by name or mobile still works.
4. Service job: uploading a file typed "Aadhaar Card" is refused with a clear message. "Udyog Aadhaar" and "PAN Card" upload.
5. Excel exports contain no Aadhaar column.
6. After steps 3 and 7 (on a disposable copy): admission still works. A direct SQL insert of an Aadhaar value is refused.

## 8. Rollback

Code: revert the branch. The old columns are only unmapped, not dropped, until step 7.
Database after step 7: restore `students` and `enquiries` from the step 5 backup into a spare database and copy back.
That is possible only during the rollback window. After that, the deletion is final, which is the purpose.
