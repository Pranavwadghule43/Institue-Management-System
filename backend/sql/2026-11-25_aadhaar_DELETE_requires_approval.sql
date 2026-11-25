-- ============================================================================================================
-- 25 Nov 2026 — Aadhaar removal, TASK A4: DESTRUCTIVE. *** DO NOT RUN WITHOUT WRITTEN APPROVAL. ***
-- ============================================================================================================
-- What it does (one transaction, all or nothing):
--   1. records the counts it is about to delete;
--   2. clears every stored Aadhaar value (ciphertext, lookup hash, last 4 digits) on students and enquiries;
--   3. marks every Aadhaar document row deleted (the FILES are removed afterwards by scripts/aadhaar_documents.py);
--   4. drops the three Aadhaar columns on both tables, their indexes and the guard triggers that watch them;
--   5. writes one audit entry with the counts (no values).
--
-- BEFORE running — every box must be ticked and the approval kept with the change record:
--   [ ] Updaate Computers (Data Fiduciary) has approved deletion in writing (who, date).
--   [ ] No legal hold or legal retention duty applies to these values (see docs/DPDP_AADHAAR_REMOVAL.md, "Retention").
--   [ ] 2026-11-25_aadhaar_inventory_READ_ONLY.sql was run and its result saved (the "before" counts).
--   [ ] A fresh encrypted backup exists (scripts/backup_db.py backup) and was verified (scripts/backup_db.py verify).
--       It is kept only for the agreed rollback window (e.g. 30 days), then destroyed — it still holds the old values.
--   [ ] The application from branch dpdp-aadhaar-removal (or later) is deployed: it does not read these columns.
--   [ ] 2026-11-25_aadhaar_block_new_values.sql was applied (it is dropped again here together with the columns).
--
-- AFTER running:
--   * Run scripts/aadhaar_documents.py delete --confirm to remove the document files from FILE_STORAGE_ROOT.
--   * Run the inventory again: parts 1-3 must show no Aadhaar columns, records or visible documents.
--   * Old values stay in Supabase backups / point-in-time recovery until they age out (plan retention), and in the
--     table's old row versions until VACUUM: run `VACUUM (FULL, ANALYZE) public.students, public.enquiries;` in a quiet
--     period (it locks the tables briefly; it cannot run inside this transaction).
-- ROLLBACK: restore the two tables (or the database) from the backup taken above into a spare database and copy back.
-- ============================================================================================================
SET client_min_messages = warning;
BEGIN;

CREATE TEMP TABLE aadhaar_removal_counts (students bigint, enquiries bigint, documents bigint) ON COMMIT DROP;

DO $remove$
DECLARE n_students bigint := 0; n_enquiries bigint := 0; n_docs bigint := 0; t text;
  doc_match constant text := $m$(coalesce(d.document_type, '') || ' ' || f.original_name) ~* '(^|[^a-z])(aadhaa?r|aadhar|adhaar|adhar)(card)?([^a-z]|$)'
                     AND (coalesce(d.document_type, '') || ' ' || f.original_name) !~* 'udyog[ _.-]*(aadhaa?r|aadhar|adhaar|adhar)'$m$;
BEGIN
  -- 1 + 2. Count and clear stored values, table by table (skipped when already removed: safe to run twice).
  FOREACH t IN ARRAY ARRAY['students', 'enquiries'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = 'aadhaar_ciphertext') THEN
      EXECUTE format('UPDATE public.%I SET aadhaar_ciphertext = NULL, aadhaar_lookup_hash = NULL, aadhaar_last4 = NULL
                       WHERE aadhaar_ciphertext IS NOT NULL OR aadhaar_lookup_hash IS NOT NULL OR aadhaar_last4 IS NOT NULL', t);
      IF t = 'students' THEN GET DIAGNOSTICS n_students = ROW_COUNT; ELSE GET DIAGNOSTICS n_enquiries = ROW_COUNT; END IF;
      -- 4. Drop the guard trigger and the columns (their indexes go with them).
      EXECUTE format('DROP TRIGGER IF EXISTS ims_refuse_new_aadhaar ON public.%I', t);
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS aadhaar_ciphertext, DROP COLUMN IF EXISTS aadhaar_lookup_hash,
                      DROP COLUMN IF EXISTS aadhaar_last4', t);
    END IF;
  END LOOP;
  DROP FUNCTION IF EXISTS public.ims_refuse_new_aadhaar();

  -- 3. Hide Aadhaar documents in the app (the FILES are removed by scripts/aadhaar_documents.py).
  EXECUTE 'UPDATE public.files f SET deleted_at = coalesce(f.deleted_at, now()) FROM public.service_job_documents d
            WHERE f.id = d.file_id AND ' || doc_match;
  EXECUTE 'UPDATE public.service_job_documents d SET deleted_at = now() FROM public.files f
            WHERE f.id = d.file_id AND d.deleted_at IS NULL AND ' || doc_match;
  GET DIAGNOSTICS n_docs = ROW_COUNT;

  INSERT INTO aadhaar_removal_counts VALUES (n_students, n_enquiries, n_docs);
  -- 5. One audit entry with the counts only (the audit log is append-only: INSERT is allowed).
  IF n_students + n_enquiries + n_docs > 0 THEN
    INSERT INTO public.audit_logs (actor_id, category, action, entity_type, entity_id, summary, after_data)
    VALUES (NULL, 'Deleted', 'AADHAAR_DATA_DELETED', 'Database', 'students+enquiries+documents',
            format('Aadhaar removed (approved): %s students, %s enquiries, %s documents', n_students, n_enquiries, n_docs),
            jsonb_build_object('students', n_students, 'enquiries', n_enquiries, 'documents', n_docs));
  END IF;
END $remove$;

SELECT * FROM aadhaar_removal_counts;  -- what was removed (0 0 0 on a second run)
COMMIT;
