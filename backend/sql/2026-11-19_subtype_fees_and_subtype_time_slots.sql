-- This schema change is covered by 2026-11-19_course_subtype_fees_and_time_slots.sql.
-- Supabase project tiusjvbrbjsxfmvhursm recorded it as 20261119114631.
-- This compatibility check is read-only. The canonical migration supplies the unique key and the foreign key.

SELECT
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'course_subtypes' AND column_name = 'fee'
          AND data_type = 'numeric' AND numeric_precision = 12 AND numeric_scale = 2 AND is_nullable = 'YES'
    ) AS subtype_fee_ready,
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'time_slots' AND column_name = 'course_subtype_id'
          AND data_type = 'bigint' AND is_nullable = 'YES'
    ) AND EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.time_slots'::regclass AND conname = 'time_slots_course_subtype_fk' AND convalidated
    ) AS slot_subtype_ready;
