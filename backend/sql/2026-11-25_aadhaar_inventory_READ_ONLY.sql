-- 25 Nov 2026 — Aadhaar removal, TASK A4/A5: READ-ONLY INVENTORY. Changes nothing. Safe on the shared database.
-- Returns COUNTS and object names only — never an Aadhaar number, last-4 digits, hash, file name or person's name.
-- Run in the Supabase SQL editor (or psql / apply_sql.py) and send the result to the security developer.
-- Spelling variants searched: aadhaar, aadhar, adhaar, adhar, uidai (and any column/table/function containing them).
-- It creates one TEMPORARY helper function (pg_temp, gone when the session ends) so it works before and after the
-- Aadhaar columns are dropped, on Supabase and on laptop databases alike. No table is changed.

CREATE OR REPLACE FUNCTION pg_temp.ims_aadhaar_count(t text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = t AND column_name = 'aadhaar_ciphertext') THEN
    RETURN 'columns removed - none stored';
  END IF;
  EXECUTE format('SELECT count(*) FILTER (WHERE aadhaar_ciphertext IS NOT NULL OR aadhaar_lookup_hash IS NOT NULL'
                 ' OR aadhaar_last4 IS NOT NULL) || '' of '' || count(*) FROM public.%I', t) INTO r;
  RETURN r;
END $f$;

-- 1. Database objects whose NAME or DEFINITION mentions Aadhaar (any schema except system schemas).
SELECT '1 column'::text AS part, (table_schema || '.' || table_name || '.' || column_name)::text AS object, data_type::text AS detail
  FROM information_schema.columns
 WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND column_name ~* '(a+d+h*a+a*r|adhar|uidai)'
UNION ALL
SELECT '1 table', table_schema || '.' || table_name, table_type
  FROM information_schema.tables
 WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_name ~* '(a+d+h*a+a*r|adhar|uidai)'
UNION ALL
SELECT '1 index', schemaname || '.' || indexname, tablename
  FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog') AND indexdef ~* '(a+d+h*a+a*r|adhar)'
UNION ALL
SELECT '1 constraint', n.nspname || '.' || conname, conrelid::regclass::text
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND pg_get_constraintdef(c.oid) ~* '(a+d+h*a+a*r|adhar)'
UNION ALL
SELECT '1 function', n.nspname || '.' || p.proname, 'definition mentions Aadhaar'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND p.prokind = 'f'
   AND (p.proname ~* '(a+d+h*a+a*r|adhar)' OR p.prosrc ~* '(a+d+h*a+a*r|adhar)')
UNION ALL
SELECT '1 view', schemaname || '.' || viewname, 'definition mentions Aadhaar'
  FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND definition ~* '(a+d+h*a+a*r|adhar)'
UNION ALL
SELECT '1 policy', schemaname || '.' || tablename || '.' || policyname, cmd
  FROM pg_policies WHERE coalesce(qual, '') || coalesce(with_check, '') ~* '(a+d+h*a+a*r|adhar)'

-- 2. Records that still hold Aadhaar data (counts only). Works before and after the columns are dropped.
UNION ALL
SELECT '2 ' || t || ' with Aadhaar', 'public.' || t, pg_temp.ims_aadhaar_count(t)
  FROM unnest(ARRAY['students', 'enquiries']) AS t

-- 3. Uploaded documents that are, or are named as, Aadhaar (service-job documents). "Udyog Aadhaar" (MSME) excluded.
UNION ALL
SELECT '3 Aadhaar documents', 'public.service_job_documents + public.files',
       count(*) || ' rows (' || count(*) FILTER (WHERE d.deleted_at IS NULL) || ' visible, '
       || count(*) FILTER (WHERE d.deleted_at IS NOT NULL) || ' deleted in the app but file kept on disk), '
       || coalesce(round(sum(f.size_bytes) / 1048576.0, 2), 0) || ' MB, uploaded '
       || coalesce(min(d.created_at)::date::text, '-') || ' to ' || coalesce(max(d.created_at)::date::text, '-')
  FROM public.service_job_documents d JOIN public.files f ON f.id = d.file_id
 WHERE (coalesce(d.document_type, '') || ' ' || f.original_name) ~* '(^|[^a-z])(aadhaa?r|aadhar|adhaar|adhar)(card)?([^a-z]|$)'
   AND (coalesce(d.document_type, '') || ' ' || f.original_name) !~* 'udyog[ _.-]*(aadhaa?r|aadhar|adhaar|adhar)'

-- 4. Historical access records (kept: they hold who/when, never the number).
UNION ALL
SELECT '4 audit entries', 'public.audit_logs', action || ': ' || count(*)
  FROM public.audit_logs WHERE action ~* 'aadhaar' GROUP BY action
ORDER BY 1, 2;

-- 5. Supabase Storage (only if the storage schema exists): objects whose path mentions Aadhaar. Run separately:
--    SELECT bucket_id, count(*) FROM storage.objects WHERE name ~* '(aadhaa?r|aadhar|adhaar|adhar)' GROUP BY bucket_id;
-- 6. Outside the database (check by hand, see docs/DPDP_AADHAAR_REMOVAL.md): FILE_STORAGE_ROOT on the server,
--    backups made with scripts/backup_db.py, Supabase daily backups / PITR, staff laptops (downloads, exported PDFs).
