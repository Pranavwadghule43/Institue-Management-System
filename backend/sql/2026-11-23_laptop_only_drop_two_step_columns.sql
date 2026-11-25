-- LAPTOP DATABASE ONLY. Removes the three two-step sign-in columns that the first version of
-- 2026-11-23_security_patches.sql added on 23 Nov morning (two-step sign-in was dropped the same day).
-- They were never on the shared Supabase database: do NOT send this file there. Safe to run twice.
SET client_min_messages = warning;
BEGIN;
ALTER TABLE public.users DROP COLUMN IF EXISTS totp_secret_ciphertext;
ALTER TABLE public.users DROP COLUMN IF EXISTS totp_enabled_at;
ALTER TABLE public.users DROP COLUMN IF EXISTS totp_last_step;
COMMIT;
SELECT column_name AS remaining_two_step_column FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'users' AND column_name LIKE 'totp%';
