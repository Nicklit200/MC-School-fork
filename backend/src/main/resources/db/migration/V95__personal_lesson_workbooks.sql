CREATE TABLE personal_lesson_workbooks (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_id VARCHAR(255) NOT NULL,
    student_id UUID NOT NULL REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    workbook_pdf BYTEA NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_personal_lesson_workbook UNIQUE (teacher_id, event_id, student_id)
);
