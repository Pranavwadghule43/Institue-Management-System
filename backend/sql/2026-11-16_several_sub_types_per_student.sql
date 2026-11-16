-- IMS: a student / enquiry can take several sub-types of their course (client meeting, 16 Nov 2026).
-- Example: DCA with "Advance excel" AND "Tally". Sub-types carry no fee, so no money changes.
--
-- What it does:
--   1. Two new link tables (one row per chosen sub-type).
--   2. Copies today's single sub-type of every student / enquiry into them, so nothing is lost.
-- What stays: the old course_subtype_id columns are kept and still hold the FIRST chosen sub-type,
-- so anything that reads them keeps working. No existing table, column or row is changed or removed.
-- Safe to run more than once. Run it BEFORE deploying the backend that has the sub-type checkboxes.
-- (PostgreSQL / Supabase. MySQL version for production is at the bottom.)

CREATE TABLE IF NOT EXISTS public.student_course_subtypes (
  student_id        bigint NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_subtype_id bigint NOT NULL REFERENCES public.course_subtypes(id),
  PRIMARY KEY (student_id, course_subtype_id)
);

CREATE TABLE IF NOT EXISTS public.enquiry_course_subtypes (
  enquiry_id        bigint NOT NULL REFERENCES public.enquiries(id) ON DELETE CASCADE,
  course_subtype_id bigint NOT NULL REFERENCES public.course_subtypes(id),
  PRIMARY KEY (enquiry_id, course_subtype_id)
);

INSERT INTO public.student_course_subtypes (student_id, course_subtype_id)
SELECT id, course_subtype_id FROM public.students WHERE course_subtype_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.enquiry_course_subtypes (enquiry_id, course_subtype_id)
SELECT id, course_subtype_id FROM public.enquiries WHERE course_subtype_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- If the project uses Row Level Security, give these two tables the same policies as public.students / public.enquiries.

-- Check: every student/enquiry that had a sub-type now has it in the new tables (both numbers should be 0).
SELECT
  (SELECT count(*) FROM public.students s WHERE s.course_subtype_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.student_course_subtypes x WHERE x.student_id = s.id AND x.course_subtype_id = s.course_subtype_id)) AS students_missing,
  (SELECT count(*) FROM public.enquiries e WHERE e.course_subtype_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM public.enquiry_course_subtypes x WHERE x.enquiry_id = e.id AND x.course_subtype_id = e.course_subtype_id)) AS enquiries_missing;

/* ---- MySQL 8 equivalent (production) ----
CREATE TABLE IF NOT EXISTS student_course_subtypes (
  student_id BIGINT NOT NULL, course_subtype_id BIGINT NOT NULL, PRIMARY KEY (student_id, course_subtype_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE, FOREIGN KEY (course_subtype_id) REFERENCES course_subtypes(id));
CREATE TABLE IF NOT EXISTS enquiry_course_subtypes (
  enquiry_id BIGINT NOT NULL, course_subtype_id BIGINT NOT NULL, PRIMARY KEY (enquiry_id, course_subtype_id),
  FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) ON DELETE CASCADE, FOREIGN KEY (course_subtype_id) REFERENCES course_subtypes(id));
INSERT IGNORE INTO student_course_subtypes SELECT id, course_subtype_id FROM students WHERE course_subtype_id IS NOT NULL;
INSERT IGNORE INTO enquiry_course_subtypes SELECT id, course_subtype_id FROM enquiries WHERE course_subtype_id IS NOT NULL;
*/
