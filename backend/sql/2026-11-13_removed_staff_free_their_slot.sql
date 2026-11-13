-- IMS: removed Staff accounts no longer count towards the 1 Admin + 4 Staff cap.
-- Date: 13 Nov 2026 - QA (Dhruvank). Goes with the "Remove account" option on Administration > Staff.
--
-- What changes: one line in the cap check - it now skips rows whose deleted_at is set (removed accounts).
-- What stays:   Disabled accounts still count (approved rule). The triggers themselves are not touched.
-- Safe to run more than once. Apply it BEFORE (or together with) the backend that has "Remove account";
-- without it, removing an account works but adding a replacement is still refused.

CREATE OR REPLACE FUNCTION public.ims_enforce_user_account_limit() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE n integer; lim integer;
BEGIN
  PERFORM 1 FROM public.account_limits WHERE id=1 FOR UPDATE;
  IF NEW.role='ADMIN' THEN SELECT max_admin INTO lim FROM public.account_limits WHERE id=1;
  ELSE SELECT max_staff INTO lim FROM public.account_limits WHERE id=1; END IF;
  SELECT count(*) INTO n FROM public.users WHERE role=NEW.role AND deleted_at IS NULL AND id IS DISTINCT FROM NEW.id;
  IF n>=lim THEN RAISE EXCEPTION 'IMS_ACCOUNT_LIMIT_REACHED role=% maximum=%',NEW.role,lim USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END $f$;

-- Check: should print the new line containing "deleted_at IS NULL".
SELECT position('deleted_at IS NULL' in prosrc) > 0 AS removed_accounts_ignored
FROM pg_proc WHERE proname = 'ims_enforce_user_account_limit';
