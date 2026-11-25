-- 23 Nov 2026 SEC-01 — READ-ONLY check of who can reach the IMS tables outside the API. Changes nothing.
-- Run in the Supabase SQL editor (or psql) and send the result to the security developer.
-- Every row returned is a finding. An empty result for parts 1-3 means the Data API can't read or change IMS data.

-- 1. Tables in "public" without row level security (Supabase's Data API exposes these to anyone with the anon key).
SELECT '1 RLS off' AS check, c.relname AS object, '' AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
UNION ALL
-- 2. Table privileges held by the web roles or by everyone (PUBLIC).
SELECT '2 web-role grant', table_name, grantee || ': ' || string_agg(privilege_type, ', ' ORDER BY privilege_type)
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
 GROUP BY table_name, grantee
UNION ALL
-- 3. Policies that let the web roles (or every role) through.
SELECT '3 web-role policy', tablename, policyname || ' (' || cmd || ') roles=' || array_to_string(roles, ',')
  FROM pg_policies
 WHERE schemaname = 'public' AND (roles && ARRAY['anon', 'authenticated', 'public']::name[])
UNION ALL
-- 4. For information: which roles can log in, and whether a dedicated API role exists yet.
SELECT '4 login role', rolname, CASE WHEN rolsuper THEN 'superuser' WHEN rolbypassrls THEN 'bypasses RLS' ELSE '' END
  FROM pg_roles
 WHERE rolcanlogin AND rolname NOT LIKE 'pg\_%' AND rolname NOT IN ('supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin',
       'supabase_realtime_admin', 'supabase_replication_admin', 'supabase_read_only_user', 'authenticator', 'pgbouncer', 'dashboard_user')
UNION ALL
-- 5. For information: is the audit log append-only yet (2026-11-23_security_patches.sql)?
SELECT '5 audit log', 'audit_logs', CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ims_audit_log_no_update_delete')
       THEN 'append-only guard present' ELSE 'NO append-only guard' END
ORDER BY 1, 2, 3;
