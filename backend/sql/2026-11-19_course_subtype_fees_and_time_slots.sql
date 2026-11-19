-- NULL fees mean no configured subtype price. NULL slot assignments are course-wide.
-- The composite foreign key keeps a slot and its subtype under the same parent course.
ALTER TABLE public.course_subtypes
    ADD COLUMN fee NUMERIC(12, 2),
    ADD CONSTRAINT course_subtypes_fee_check CHECK (fee >= 0 AND fee <> 'NaN'::numeric),
    ADD CONSTRAINT course_subtypes_course_id_id_key UNIQUE (course_id, id);

ALTER TABLE public.time_slots
    ADD COLUMN course_subtype_id BIGINT,
    ADD CONSTRAINT time_slots_course_subtype_fk FOREIGN KEY (course_id, course_subtype_id)
        REFERENCES public.course_subtypes (course_id, id);
