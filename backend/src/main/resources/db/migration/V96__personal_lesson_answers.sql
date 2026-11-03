-- Answer keys have no connection to the pupil-facing workbook byte routes.
CREATE TABLE personal_lesson_answers (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_id VARCHAR(255) NOT NULL,
    student_id UUID NOT NULL REFERENCES users(id),
    filename VARCHAR(255) NOT NULL,
    answers_pdf BYTEA NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_personal_lesson_answers UNIQUE (teacher_id, event_id, student_id)
);
