-- IMS: final Aadhaar removal (26 Nov 2026). PostgreSQL / Supabase.
--
-- Decision (team instruction, 26 Nov 2026): IMS does not collect, store or retain anyone's personal Aadhaar information.
-- Verified on Supabase before this file was written: the six columns below hold zero non-null values, and the
-- document metadata tables hold zero Aadhaar records.
--
-- What it does, in ONE transaction (all or nothing):
--   1. Preflight. It stops without changing anything if:
--      - any of the six columns still holds a value, or
--      - any unrelated object depends on them (a view, a policy, an index or constraint that also covers another column).
--   2. Removes the 25 Nov guard triggers on students and enquiries (they read these columns), then drops the six columns.
--      Indexes or constraints that cover ONLY these columns go with them, and are listed first.
--   3. Safeguards so Aadhaar cannot come back:
--      a. a trigger on service_job_documents that refuses Aadhaar documents by type or file name (Udyog Aadhaar / MSME is allowed);
--      b. an event trigger that refuses any new column named like Aadhaar in the public schema. If the role running this
--         may not create event triggers, it prints a NOTICE and carries on: the app and the tests still enforce this.
--   4. Writes one audit entry (column names only, no data).
--
-- ORDER (important):
--   0. Deploy a backend built from branch dhruvank-dpdp-aadhaar-removal (or later) FIRST. Older builds, including
--      integration/mysql84-dhruvank @ 7ec0c92, still read these columns and would fail once they are gone.
--   1. Take and verify a backup:  python scripts/backup_db.py --env-file <env> backup --out <dir>   then   verify <file>
--   2. Run:  psql "<DATABASE_URL>" -v ON_ERROR_STOP=1 -f sql/2026-11-26_aadhaar_final_removal.sql
--      (or paste into the Supabase SQL editor and run it as one script).
--   3. Run sql/2026-11-25_aadhaar_inventory_READ_ONLY.sql. It must show no Aadhaar columns and no Aadhaar documents.
--
-- Safe to run twice: the second run finds nothing to drop and just re-creates the safeguards.
-- Touches only: the six columns, the indexes/constraints that exist only for them, the two old triggers and their function,
-- and the safeguard objects named ims_refuse_aadhaar_*. No rows are deleted or changed (one audit row is added).

SET client_min_messages = notice;
BEGIN;
SET LOCAL lock_timeout = '5s';         -- fail fast instead of queueing behind app traffic; just run it again
SET LOCAL statement_timeout = '120s';

-- ------------------------------------------------------------------ 1. Preflight
CREATE TEMP TABLE aadhaar_cols ON COMMIT DROP AS
  SELECT a.attrelid AS rel, a.attrelid::regclass::text AS tbl, a.attnum, a.attname::text AS col
    FROM pg_attribute a
   WHERE a.attrelid IN (to_regclass('public.students'), to_regclass('public.enquiries'))
     AND a.attname IN ('aadhaar_ciphertext', 'aadhaar_last4', 'aadhaar_lookup_hash')
     AND a.attnum > 0 AND NOT a.attisdropped;

DO $pre$
DECLARE c record; n bigint; problems text := ''; removed text := '';
BEGIN
  -- a. No values may remain (verified zero on Supabase; this guards against anything written since).
  FOR c IN SELECT * FROM aadhaar_cols ORDER BY tbl, col LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IS NOT NULL', c.tbl, c.col) INTO n;
    IF n > 0 THEN problems := problems || format(E'\n  %s.%s holds %s value(s)', c.tbl, c.col, n); END IF;
  END LOOP;

  -- b. Every object that depends on these columns must exist only for them.
  FOR c IN
    SELECT d.classid::regclass::text AS kind,
           CASE d.classid
             WHEN 'pg_class'::regclass      THEN d.objid::regclass::text
             WHEN 'pg_constraint'::regclass THEN (SELECT conname::text FROM pg_constraint WHERE oid = d.objid)
             WHEN 'pg_trigger'::regclass    THEN (SELECT tgname::text FROM pg_trigger WHERE oid = d.objid)
             WHEN 'pg_policy'::regclass     THEN (SELECT polname::text FROM pg_policy WHERE oid = d.objid)
             WHEN 'pg_rewrite'::regclass    THEN (SELECT 'view ' || ev_class::regclass::text FROM pg_rewrite WHERE oid = d.objid)
             ELSE d.objid::text END AS name,
           d.classid, d.objid
      FROM pg_depend d
     WHERE d.refclassid = 'pg_class'::regclass
       AND (d.refobjid, d.refobjsubid) IN (SELECT rel, attnum FROM aadhaar_cols)
       AND d.classid <> 'pg_attrdef'::regclass          -- a column's own default goes with the column
     GROUP BY d.classid, d.objid
  LOOP
    IF c.classid = 'pg_class'::regclass
       AND NOT EXISTS (SELECT 1 FROM pg_depend o                  -- an index: every column it uses must be an Aadhaar column
                        WHERE o.classid = 'pg_class'::regclass AND o.objid = c.objid
                          AND o.refclassid = 'pg_class'::regclass AND o.refobjsubid > 0
                          AND (o.refobjid, o.refobjsubid) NOT IN (SELECT rel, attnum FROM aadhaar_cols)) THEN
      removed := removed || format(E'\n  index %s', c.name);
    ELSIF c.classid = 'pg_constraint'::regclass
       AND (SELECT bool_and(k = ANY (SELECT x.attnum FROM aadhaar_cols x WHERE x.rel = con.conrelid))
              FROM pg_constraint con, unnest(con.conkey) k WHERE con.oid = c.objid) THEN
      removed := removed || format(E'\n  constraint %s', c.name);
    ELSE
      problems := problems || format(E'\n  %s %s depends on an Aadhaar column and on other things', c.kind, c.name);
    END IF;
  END LOOP;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Stopped, nothing changed:%', problems
      USING HINT = 'Send this message to the developer. Do not drop anything by hand.';
  END IF;
  RAISE NOTICE 'Preflight OK. Columns to drop: %. Also removed with them: %',
    coalesce((SELECT string_agg(tbl || '.' || col, ', ' ORDER BY tbl, col) FROM aadhaar_cols), 'none (already removed)'),
    CASE WHEN removed = '' THEN 'nothing' ELSE removed END;
END $pre$;

-- Remember what this run removes, for the audit entry and the result table.
CREATE TEMP TABLE aadhaar_removed ON COMMIT DROP AS SELECT tbl, col FROM aadhaar_cols;

-- ------------------------------------------------------------------ 2. Remove the columns
DROP TRIGGER IF EXISTS ims_refuse_new_aadhaar ON public.students;
DROP TRIGGER IF EXISTS ims_refuse_new_aadhaar ON public.enquiries;
DROP FUNCTION IF EXISTS public.ims_refuse_new_aadhaar();

ALTER TABLE public.students
  DROP COLUMN IF EXISTS aadhaar_ciphertext,
  DROP COLUMN IF EXISTS aadhaar_last4,
  DROP COLUMN IF EXISTS aadhaar_lookup_hash;          -- RESTRICT (default): fails if anything unexpected still depends
ALTER TABLE public.enquiries
  DROP COLUMN IF EXISTS aadhaar_ciphertext,
  DROP COLUMN IF EXISTS aadhaar_last4,
  DROP COLUMN IF EXISTS aadhaar_lookup_hash;

-- ------------------------------------------------------------------ 3a. Refuse Aadhaar documents
CREATE OR REPLACE FUNCTION public.ims_refuse_aadhaar_document() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE label text;
BEGIN
  SELECT coalesce(NEW.document_type, '') || ' ' || coalesce(f.original_name, '') INTO label FROM public.files f WHERE f.id = NEW.file_id;
  label := coalesce(label, coalesce(NEW.document_type, ''));
  -- Udyog Aadhaar is an MSME business registration, not a person's Aadhaar: it is allowed.
  label := regexp_replace(label, 'udyog[^a-z]*(aadhaa?r|aadhar|adhaar|adhar)', ' ', 'gi');
  IF label ~* '(^|[^a-z])(aadhaa?r|aadhar|adhaar|adhar|uidai)(card)?([^a-z]|$)' THEN
    RAISE EXCEPTION 'IMS_AADHAAR_NOT_COLLECTED: Aadhaar documents are not collected by IMS'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.ims_refuse_aadhaar_document() FROM PUBLIC;

DROP TRIGGER IF EXISTS ims_refuse_aadhaar_document ON public.service_job_documents;
CREATE TRIGGER ims_refuse_aadhaar_document BEFORE INSERT OR UPDATE OF document_type, file_id ON public.service_job_documents
  FOR EACH ROW EXECUTE FUNCTION public.ims_refuse_aadhaar_document();

-- ------------------------------------------------------------------ 3b. Refuse new Aadhaar columns (schema guard)
CREATE OR REPLACE FUNCTION public.ims_refuse_aadhaar_columns() RETURNS event_trigger LANGUAGE plpgsql
  SET search_path TO 'pg_catalog' AS $f$
DECLARE r record; found text;
BEGIN
  FOR r IN SELECT objid, object_identity FROM pg_event_trigger_ddl_commands()
            WHERE schema_name = 'public' AND object_type IN ('table', 'table column', 'view', 'materialized view')
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ') INTO found
      FROM pg_attribute a
     WHERE a.attrelid = r.objid AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attname ~* '(aadhaa?r|aadhar|adhaar|adhar|uidai)' AND a.attname !~* 'udyog';
    IF found IS NOT NULL THEN
      RAISE EXCEPTION 'IMS_AADHAAR_NOT_COLLECTED: IMS does not store Aadhaar; column % on % refused', found, r.object_identity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public.ims_refuse_aadhaar_columns() FROM PUBLIC;

DO $guard$
BEGIN
  DROP EVENT TRIGGER IF EXISTS ims_refuse_aadhaar_columns;
  CREATE EVENT TRIGGER ims_refuse_aadhaar_columns ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'ALTER TABLE', 'CREATE VIEW', 'CREATE MATERIALIZED VIEW')
    EXECUTE FUNCTION public.ims_refuse_aadhaar_columns();
  RAISE NOTICE 'Schema guard installed (event trigger ims_refuse_aadhaar_columns).';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Schema guard NOT installed: this role may not create event triggers. Everything else is done.';
END $guard$;

-- ------------------------------------------------------------------ 4. Audit entry (names only, no data)
INSERT INTO public.audit_logs (actor_id, category, action, entity_type, entity_id, summary, after_data)
SELECT NULL, 'Deleted', 'AADHAAR_COLUMNS_DROPPED', 'Database', 'students+enquiries',
       format('Aadhaar removed from IMS: %s empty column(s) dropped; document and schema guards in place', count(*)),
       jsonb_build_object('columns', coalesce(jsonb_agg(tbl || '.' || col ORDER BY tbl, col), '[]'::jsonb))
  FROM aadhaar_removed
HAVING count(*) > 0;                    -- a repeat run that drops nothing adds no entry

-- Result: what this run dropped (empty on a second run), then the safeguards in place.
SELECT tbl || '.' || col AS dropped_column FROM aadhaar_removed ORDER BY 1;
COMMIT;

SELECT 'trigger' AS safeguard, tgname::text AS name, tgrelid::regclass::text AS on_object
  FROM pg_trigger WHERE tgname = 'ims_refuse_aadhaar_document'
UNION ALL
SELECT 'event trigger', evtname::text, 'public schema (new columns)' FROM pg_event_trigger WHERE evtname = 'ims_refuse_aadhaar_columns'
UNION ALL
SELECT 'columns left', count(*)::text, 'must be 0'
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name ~* '(aadhaa?r|aadhar|adhaar|adhar|uidai)' AND column_name !~* 'udyog';
