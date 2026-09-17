CREATE TABLE parent_teacher_messages (
    id UUID PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES users(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    message_text TEXT,
    image_data BYTEA,
    image_filename VARCHAR(255),
    image_mime_type VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX parent_teacher_messages_student_created_idx
    ON parent_teacher_messages(student_id, created_at);
