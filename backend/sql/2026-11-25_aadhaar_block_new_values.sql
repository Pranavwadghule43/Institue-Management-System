-- 25 Nov 2026 — Aadhaar removal, TASK A4: NON-DESTRUCTIVE database guard. No data is changed or deleted.
-- The application (branch dpdp-aadhaar-removal) already refuses Aadhaar. This guard makes the database refuse it too,
-- for any client or script that bypasses the API:
--   * students / enquiries: a NEW Aadhaar value can't be written (insert, or update to a different non-empty value).
--     Clearing an old value (setting it to NULL) is still allowed, so the approved deletion migration can run later.
--   * service_job_documents: a document typed or named as Aadhaar can't be added ("Udyog Aadhaar" — MSME — is allowed).
-- Shared database: run only after review/approval (it is a schema change, though not destructive). Safe to run twice.
SET client_min_messages = warning;
BEGIN;

CREATE OR REPLACE FUNCTION public.ims_refuse_new_aadhaar() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW.aadhaar_ciphertext IS NOT NULL OR NEW.aadhaar_lookup_hash IS NOT NULL OR NEW.aadhaar_last4 IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (
          (NEW.aadhaar_ciphertext IS NOT NULL AND NEW.aadhaar_ciphertext IS DISTINCT FROM OLD.aadhaar_ciphertext)
       OR (NEW.aadhaar_lookup_hash IS NOT NULL AND NEW.aadhaar_lookup_hash IS DISTINCT FROM OLD.aadhaar_lookup_hash)
       OR (NEW.aadhaar_last4 IS NOT NULL AND NEW.aadhaar_last4 IS DISTINCT FROM OLD.aadhaar_last4))) THEN
    RAISE EXCEPTION 'IMS_AADHAAR_NOT_COLLECTED: Aadhaar is no longer collected by IMS (%)', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS ims_refuse_new_aadhaar ON public.students;
CREATE TRIGGER ims_refuse_new_aadhaar BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.ims_refuse_new_aadhaar();
DROP TRIGGER IF EXISTS ims_refuse_new_aadhaar ON public.enquiries;
CREATE TRIGGER ims_refuse_new_aadhaar BEFORE INSERT OR UPDATE ON public.enquiries
  FOR EACH ROW EXECUTE FUNCTION public.ims_refuse_new_aadhaar();

CREATE OR REPLACE FUNCTION public.ims_refuse_aadhaar_document() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $f$
DECLARE label text;
BEGIN
  SELECT coalesce(NEW.document_type, '') || ' ' || coalesce(f.original_name, '') INTO label FROM public.files f WHERE f.id = NEW.file_id;
  label := coalesce(label, coalesce(NEW.document_type, ''));
  IF label ~* '(^|[^a-z])(aadhaa?r|aadhar|adhaar|adhar)(card)?([^a-z]|$)'
     AND label !~* 'udyog[ _.-]*(aadhaa?r|aadhar|adhaar|adhar)' THEN
    RAISE EXCEPTION 'IMS_AADHAAR_NOT_COLLECTED: Aadhaar documents are no longer collected by IMS'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS ims_refuse_aadhaar_document ON public.service_job_documents;
CREATE TRIGGER ims_refuse_aadhaar_document BEFORE INSERT ON public.service_job_documents
  FOR EACH ROW EXECUTE FUNCTION public.ims_refuse_aadhaar_document();

COMMIT;

-- Check (read-only): expect 3 triggers.
SELECT tgname AS trigger, tgrelid::regclass::text AS on_table
  FROM pg_trigger WHERE tgname IN ('ims_refuse_new_aadhaar', 'ims_refuse_aadhaar_document') ORDER BY 2;

/* ---------------------------------------------------------------- MySQL 8.4 equivalent (production target, paused)
DELIMITER //
CREATE TRIGGER ims_refuse_new_aadhaar_students_ins BEFORE INSERT ON students FOR EACH ROW
  IF NEW.aadhaar_ciphertext IS NOT NULL OR NEW.aadhaar_lookup_hash IS NOT NULL OR NEW.aadhaar_last4 IS NOT NULL THEN
    SIGNAL SQLSTATE '23514' SET MESSAGE_TEXT = 'IMS_AADHAAR_NOT_COLLECTED'; END IF;//
CREATE TRIGGER ims_refuse_new_aadhaar_students_upd BEFORE UPDATE ON students FOR EACH ROW
  IF (NEW.aadhaar_ciphertext IS NOT NULL AND NOT (NEW.aadhaar_ciphertext <=> OLD.aadhaar_ciphertext))
     OR (NEW.aadhaar_last4 IS NOT NULL AND NOT (NEW.aadhaar_last4 <=> OLD.aadhaar_last4)) THEN
    SIGNAL SQLSTATE '23514' SET MESSAGE_TEXT = 'IMS_AADHAAR_NOT_COLLECTED'; END IF;//
-- (repeat both for enquiries)
DELIMITER ;
*/
