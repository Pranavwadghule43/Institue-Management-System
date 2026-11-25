-- 23 Nov 2026 SEC-01 / SEC-14 — close the Supabase Data API to IMS data and create a limited role for the API.
-- WHO: the Supabase project owner, in the SQL editor, after review and approval (shared database).
-- WHEN: after 2026-11-23_security_patches.sql. Run 2026-11-23_check_data_api_access.sql before and after.
-- WHAT IT CHANGES:
--   * turns on row level security for every table in "public" (the API's own roles keep working: see below);
--   * removes every table / sequence / function privilege from anon and authenticated (the browser keys), now and
--     for tables created later;
--   * creates role ims_api (no password yet, cannot log in until the owner sets one) with read/write on the IMS
--     tables, but no schema changes, and append-only access to audit_logs.
-- WHAT IT DOES NOT CHANGE: no data, no existing developer role or its policies, no table owner, the postgres login.
-- Safe to run twice.
SET client_min_messages = warning;
BEGIN;

-- 1. Row level security on every IMS table. Table owners and the postgres role are not affected by RLS.
DO $rls$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $rls$;

-- 2. The browser roles get nothing in "public", now or later.
DO $web$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $web$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- 3. The API's own role: data in and out, no DDL, no bypassing RLS, no superuser.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ims_api') THEN
    CREATE ROLE ims_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END $role$;
GRANT USAGE ON SCHEMA public TO ims_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ims_api;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM ims_api;  -- SEC-14: append-only for the API
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ims_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ims_api;

-- 4. RLS policies for ims_api: the API checks permissions itself, so every row is visible to it.
DO $pol$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('DROP POLICY IF EXISTS ims_api_rw ON public.%I', t.relname);
    IF t.relname = 'audit_logs' THEN
      EXECUTE 'DROP POLICY IF EXISTS ims_api_read ON public.audit_logs';
      EXECUTE 'DROP POLICY IF EXISTS ims_api_append ON public.audit_logs';
      EXECUTE 'CREATE POLICY ims_api_read ON public.audit_logs FOR SELECT TO ims_api USING (true)';
      EXECUTE 'CREATE POLICY ims_api_append ON public.audit_logs FOR INSERT TO ims_api WITH CHECK (true)';
    ELSE
      EXECUTE format('CREATE POLICY ims_api_rw ON public.%I FOR ALL TO ims_api USING (true) WITH CHECK (true)', t.relname);
    END IF;
  END LOOP;
END $pol$;

COMMIT;

-- NEXT (owner, by hand — never put the password in a file or in chat):
--   ALTER ROLE ims_api WITH LOGIN PASSWORD '<long random password>';
-- Then set the live API's DATABASE_URL to user "ims_api.<project-ref>" on the session pooler, with
-- ?sslmode=verify-full&sslrootcert=<Supabase CA file>. Keep the postgres / developer logins for migrations only.
-- Tables added later need: GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO ims_api; plus an ims_api_rw policy.

-- Check (read-only): expect no rows from parts 1-3 of 2026-11-23_check_data_api_access.sql.
