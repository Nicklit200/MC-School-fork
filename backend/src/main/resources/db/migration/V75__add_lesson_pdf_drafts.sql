CREATE TABLE lesson_pdf_drafts (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_id VARCHAR(255) NOT NULL,
    workbook_filename VARCHAR(255) NOT NULL,
    answers_filename VARCHAR(255) NOT NULL,
    workbook_pdf BYTEA NOT NULL,
    answers_pdf BYTEA NOT NULL,
    lesson_plan TEXT,
    difficulties TEXT,
    task_count INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    CONSTRAINT lesson_pdf_drafts_valid_status CHECK (status IN ('DRAFT', 'PUBLISHED'))
);
CREATE INDEX idx_lesson_pdf_drafts_teacher_event ON lesson_pdf_drafts (teacher_id, event_id, created_at DESC);
