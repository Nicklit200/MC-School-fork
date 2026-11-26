-- Parent-only, pupil-scoped lesson summaries derived from saved transcripts.
-- Deliberately separate from graded mastery: qualitative reports must NOT modify percentages.
CREATE TABLE parent_lesson_recaps (
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state VARCHAR(16) NOT NULL DEFAULT 'RUNNING'
        CHECK (state IN ('RUNNING','DONE','SKIPPED','FAILED')),
    summary TEXT,
    observations JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_kind VARCHAR(32),
    failure_code VARCHAR(80),
    attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (class_id,student_id),
    CHECK (summary IS NULL OR length(summary) <= 2400),
    CHECK (jsonb_typeof(observations) = 'array'),
    CHECK (octet_length(observations::text) <= 20000)
);
CREATE INDEX idx_parent_lesson_recaps_pending
    ON parent_lesson_recaps(state,updated_at)
    WHERE state IN ('RUNNING','FAILED');
