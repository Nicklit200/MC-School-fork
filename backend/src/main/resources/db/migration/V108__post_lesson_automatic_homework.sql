-- One accepted submission per finished classroom, including the frozen eligible roster.
-- Replays never create another series. Only verified PDFs may be published.
CREATE TABLE post_lesson_homework_jobs (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL UNIQUE REFERENCES online_classes(id),
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_id VARCHAR(255) NOT NULL,
    lesson_title VARCHAR(255) NOT NULL,
    days SMALLINT NOT NULL CHECK (days BETWEEN 1 AND 7),
    start_date DATE NOT NULL,
    teacher_instructions TEXT NOT NULL DEFAULT '',
    roster_json TEXT NOT NULL,
    selection_json TEXT,
    state VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
        CHECK (state IN ('QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED')),
    expected_files INTEGER NOT NULL DEFAULT 0 CHECK (expected_files >= 0),
    generated_files INTEGER NOT NULL DEFAULT 0 CHECK (generated_files >= 0),
    failure_code VARCHAR(60),
    worker_id UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    CHECK (length(teacher_instructions) <= 3000),
    CHECK (octet_length(roster_json) <= 20000),
    CHECK (selection_json IS NULL OR octet_length(selection_json) <= 20000)
);

-- Work products persist across browser closure and backend restarts.
-- Teacher answers are never copied into student homework records.
CREATE TABLE post_lesson_homework_drafts (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES post_lesson_homework_jobs(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id),
    day_number SMALLINT NOT NULL CHECK (day_number BETWEEN 1 AND 7),
    assignment_date DATE NOT NULL,
    student_pdf BYTEA NOT NULL,
    teacher_pdf BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, student_id, day_number),
    CHECK (octet_length(student_pdf) BETWEEN 1 AND 15728640),
    CHECK (octet_length(teacher_pdf) BETWEEN 1 AND 15728640)
);

CREATE INDEX post_lesson_homework_queue
    ON post_lesson_homework_jobs(created_at) WHERE state = 'QUEUED';
CREATE INDEX post_lesson_homework_drafts_student
    ON post_lesson_homework_drafts(job_id, student_id, day_number);
