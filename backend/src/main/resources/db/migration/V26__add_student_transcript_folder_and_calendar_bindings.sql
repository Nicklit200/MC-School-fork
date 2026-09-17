ALTER TABLE users
    ADD COLUMN google_drive_transcript_folder_id VARCHAR(1000);

CREATE TABLE google_calendar_lesson_bindings (
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_key VARCHAR(255) NOT NULL,
    student_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (teacher_id, event_key)
);

CREATE INDEX idx_calendar_lesson_bindings_student
    ON google_calendar_lesson_bindings(student_id);
