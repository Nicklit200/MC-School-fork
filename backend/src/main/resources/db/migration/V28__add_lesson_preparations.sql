CREATE TABLE lesson_preparations (
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_id VARCHAR(255) NOT NULL,
    homework_notes TEXT,
    difficulties TEXT,
    lesson_plan TEXT,
    workbook_pdf BYTEA,
    workbook_filename VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (teacher_id, event_id)
);
