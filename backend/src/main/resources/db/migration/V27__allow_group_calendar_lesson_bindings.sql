ALTER TABLE google_calendar_lesson_bindings
    ADD COLUMN group_id UUID REFERENCES student_groups(id);

ALTER TABLE google_calendar_lesson_bindings
    ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE google_calendar_lesson_bindings
    ADD CONSTRAINT chk_google_calendar_lesson_binding_target
    CHECK (
        (student_id IS NOT NULL AND group_id IS NULL)
        OR (student_id IS NULL AND group_id IS NOT NULL)
    );

CREATE INDEX idx_calendar_lesson_bindings_group
    ON google_calendar_lesson_bindings(group_id);
