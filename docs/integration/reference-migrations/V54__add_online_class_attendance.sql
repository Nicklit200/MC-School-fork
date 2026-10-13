-- Final attendance is confirmed by the teacher at lesson end. Unlike
-- online_class_participants this table also records students who never joined.

CREATE TABLE online_class_attendance (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL
        CONSTRAINT online_class_attendance_status_check
        CHECK (status IN ('PRESENT', 'ABSENT')),
    connected_seconds BIGINT NOT NULL DEFAULT 0,
    confirmed_at TIMESTAMPTZ NOT NULL,
    confirmed_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT online_class_attendance_seconds_non_negative CHECK (connected_seconds >= 0)
);

CREATE UNIQUE INDEX uq_online_class_attendance
    ON online_class_attendance(class_id, student_id);
CREATE INDEX idx_online_class_attendance_student
    ON online_class_attendance(student_id, confirmed_at DESC);
