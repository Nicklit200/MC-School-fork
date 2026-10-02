ALTER TABLE lesson_preparations
    ADD COLUMN IF NOT EXISTS transcript_text text;

CREATE TABLE IF NOT EXISTS lesson_history (
    teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id varchar(255) NOT NULL,
    binding_key varchar(255),
    group_id uuid,
    group_name varchar(255),
    student_id uuid,
    student_name varchar(255),
    participant_student_ids text,
    title varchar(500) NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    meet_url text,
    calendar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (teacher_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_history_teacher_starts_at
    ON lesson_history (teacher_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_history_group
    ON lesson_history (teacher_id, group_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_history_student
    ON lesson_history (teacher_id, student_id, starts_at DESC);
