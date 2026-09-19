-- Mindcrafti-native scheduling. Google Calendar remains an optional source,
-- but lessons created here are first-class and can run without Google.

CREATE TABLE native_lessons (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    student_id UUID REFERENCES users(id),
    group_id UUID REFERENCES student_groups(id),

    title VARCHAR(255) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,

    -- Occurrences created by one "repeat weekly" action share this id.
    series_id UUID NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT native_lessons_exactly_one_target CHECK (
        (student_id IS NOT NULL AND group_id IS NULL)
        OR (student_id IS NULL AND group_id IS NOT NULL)
    ),
    CONSTRAINT native_lessons_schedule_order CHECK (ends_at > starts_at)
);

CREATE INDEX idx_native_lessons_teacher_start
    ON native_lessons(teacher_id, starts_at);
CREATE INDEX idx_native_lessons_student_start
    ON native_lessons(student_id, starts_at) WHERE student_id IS NOT NULL;
CREATE INDEX idx_native_lessons_group_start
    ON native_lessons(group_id, starts_at) WHERE group_id IS NOT NULL;
CREATE INDEX idx_native_lessons_series
    ON native_lessons(series_id, starts_at);
