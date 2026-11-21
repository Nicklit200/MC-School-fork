CREATE TABLE kolin_teacher_questions (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id),
    client_message_id UUID,
    question_text TEXT NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    student_id UUID REFERENCES users(id),
    current_workbook_page INTEGER,
    format VARCHAR(16),
    status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT kolin_teacher_questions_text_check
        CHECK (char_length(question_text) BETWEEN 1 AND 4000),
    CONSTRAINT kolin_teacher_questions_target_check
        CHECK (
            (target_type = 'group' AND student_id IS NULL)
            OR (target_type = 'student' AND student_id IS NOT NULL)
        ),
    CONSTRAINT kolin_teacher_questions_page_check
        CHECK (current_workbook_page IS NULL OR current_workbook_page BETWEEN 1 AND 1000),
    CONSTRAINT kolin_teacher_questions_format_check
        CHECK (format IS NULL OR format IN ('pdf', 'interactive')),
    CONSTRAINT kolin_teacher_questions_status_check
        CHECK (status IN ('RECEIVED', 'ANSWERED', 'FAILED'))
);

-- Browser retries keep their original client message id. Store one durable
-- question per teacher/class/id without preventing legacy clients from sending
-- questions that do not yet have an id.
CREATE UNIQUE INDEX uq_kolin_teacher_questions_client_message
    ON kolin_teacher_questions(teacher_id, class_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE INDEX idx_kolin_teacher_questions_recent
    ON kolin_teacher_questions(teacher_id, class_id, created_at DESC);
