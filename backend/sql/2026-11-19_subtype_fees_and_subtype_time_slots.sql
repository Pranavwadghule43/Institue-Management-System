-- IMS: course sub-type fees + time slots for a sub-type (client updates, 19 Nov 2026).
-- FOR APPROVAL BEFORE RUNNING ON THE SHARED SUPABASE DATABASE (project tiusjvbrbjsxfmvhursm) - Pranav, DB owner.
--
-- What it does (all additive, nothing existing is changed, rewritten or removed):
--   1. course_subtypes.fee        - new, optional (NULL = the sub-type has no fee of its own), never negative.
--   2. time_slots.course_subtype_id - new, optional (NULL = a whole-course slot, i.e. every existing slot today).
--   3. The database itself refuses a time slot whose sub-type belongs to another course (composite foreign key).
--   4. An index for looking up slots by sub-type.
-- Existing students, fees, payments, receipts, bills, RLS policies, roles and numbering are not touched.
-- Every existing row keeps working: all new values start as NULL.
-- Safe to run more than once. Run it BEFORE deploying the backend that has these features.
-- (PostgreSQL / Supabase. MySQL 8 version for production at the bottom.)

ALTER TABLE public.course_subtypes ADD COLUMN IF NOT EXISTS fee numeric(12, 2);
ALTER TABLE public.time_slots ADD COLUMN IF NOT EXISTS course_subtype_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_subtypes_fee_check') THEN
    ALTER TABLE public.course_subtypes ADD CONSTRAINT course_subtypes_fee_check CHECK (fee >= 0);
  END IF;
  -- (id, course_id) is unique already because id is; this named key lets time_slots point at the pair.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_subtypes_id_course_id_key') THEN
    ALTER TABLE public.course_subtypes ADD CONSTRAINT course_subtypes_id_course_id_key UNIQUE (id, course_id);
  END IF;
  -- A slot's sub-type must be a sub-type of the slot's own course. NULL sub-type = not checked (whole-course slot).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_slots_course_subtype_fkey') THEN
    ALTER TABLE public.time_slots ADD CONSTRAINT time_slots_course_subtype_fkey
      FOREIGN KEY (course_subtype_id, course_id) REFERENCES public.course_subtypes (id, course_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_time_slots_course_subtype ON public.time_slots (course_subtype_id);

-- RLS: no new tables, so no new policies are needed; existing policies on these two tables cover the new columns.

-- Check: should return true, true, 0, 0 (both columns exist; no existing row was given a value).
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'course_subtypes' AND column_name = 'fee') AS subtype_fee_added,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_slots_course_subtype_fkey') AS slot_subtype_rule_added,
  (SELECT count(*) FROM public.course_subtypes WHERE fee IS NOT NULL) AS subtypes_with_fee,
  (SELECT count(*) FROM public.time_slots WHERE course_subtype_id IS NOT NULL) AS slots_with_subtype;

/* ---- MySQL 8 equivalent (production) ----
ALTER TABLE course_subtypes ADD COLUMN fee DECIMAL(12,2) NULL, ADD CONSTRAINT course_subtypes_fee_check CHECK (fee >= 0);
ALTER TABLE course_subtypes ADD CONSTRAINT course_subtypes_id_course_id_key UNIQUE (id, course_id);
ALTER TABLE time_slots ADD COLUMN course_subtype_id BIGINT NULL,
  ADD CONSTRAINT time_slots_course_subtype_fkey FOREIGN KEY (course_subtype_id, course_id) REFERENCES course_subtypes (id, course_id);
CREATE INDEX idx_time_slots_course_subtype ON time_slots (course_subtype_id);
*/
