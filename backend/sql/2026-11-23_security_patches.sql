-- 23 Nov 2026 security patches (IMS Security Review: SEC-05, SEC-14, forgotten Admin password).
-- Apply as the IMS schema owner, after review, BEFORE starting the backend from branch dhruvank-security-patches.
-- Non-destructive: adds 2 nullable/defaulted columns to users and an append-only guard on audit_logs.
-- No existing row is changed. Safe to run twice. Ends with a read-only check query.
SET client_min_messages = warning;
BEGIN;

-- SEC-05: temporary passwords (new staff, Admin reset) must be changed at the next sign-in.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
-- Forgotten Admin password: one-time recovery key, stored only as a scrypt hash (the key is shown once in the app).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_key_hash text;

-- SEC-14: the audit log can only grow. UPDATE, DELETE and TRUNCATE are refused for every role, including the API's.
-- (The table owner can still drop this trigger deliberately; that change itself is visible in the schema.)
CREATE OR REPLACE FUNCTION public.ims_audit_log_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  RAISE EXCEPTION 'IMS_AUDIT_LOG_APPEND_ONLY: audit_logs rows cannot be changed or removed (%)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $f$;

DROP TRIGGER IF EXISTS ims_audit_log_no_update_delete ON public.audit_logs;
CREATE TRIGGER ims_audit_log_no_update_delete BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.ims_audit_log_append_only();
DROP TRIGGER IF EXISTS ims_audit_log_no_truncate ON public.audit_logs;
CREATE TRIGGER ims_audit_log_no_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.ims_audit_log_append_only();

COMMIT;

-- Check (read-only): expect 2 columns and 2 triggers.
SELECT 'users.' || column_name AS item, data_type AS detail
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users'
   AND column_name IN ('must_change_password', 'recovery_key_hash')
UNION ALL
SELECT 'trigger ' || tgname, 'on audit_logs'
  FROM pg_trigger WHERE tgrelid = 'public.audit_logs'::regclass AND tgname LIKE 'ims_audit_log_%'
ORDER BY 1;

/* ---------------------------------------------------------------- MySQL 8.4 equivalent (production target)
ALTER TABLE users
  ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN recovery_key_hash TEXT NULL;

DELIMITER //
CREATE TRIGGER ims_audit_log_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '42501' SET MESSAGE_TEXT = 'IMS_AUDIT_LOG_APPEND_ONLY: audit_logs rows cannot be changed or removed';//
CREATE TRIGGER ims_audit_log_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
  SIGNAL SQLSTATE '42501' SET MESSAGE_TEXT = 'IMS_AUDIT_LOG_APPEND_ONLY: audit_logs rows cannot be changed or removed';//
DELIMITER ;
-- MySQL has no TRUNCATE trigger: do not grant DROP on audit_logs to the API user.
*/
