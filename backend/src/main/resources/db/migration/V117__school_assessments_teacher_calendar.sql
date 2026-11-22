-- School assessment dates are all-day informational markers in teacher agendas.
-- They are NOT online lessons and do not create LiveKit or Google Meet sessions.
CREATE TABLE school_assessments (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    student_id UUID NOT NULL REFERENCES users(id),
    exam_date DATE NOT NULL,
    kind VARCHAR(32) NOT NULL CHECK(kind IN ('KLASSENARBEIT','TEST','EXAM','QUIZ','OTHER')),
    title VARCHAR(180) NOT NULL,
    topics JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes VARCHAR(2500),
    source_type VARCHAR(32) NOT NULL CHECK(source_type IN ('TRANSCRIPT','STUDENT_REPORTED','TEACHER_NOTE','VOICE_NOTE','SCHOOL_DOCUMENT')),
    source_ref VARCHAR(300),
    source_excerpt VARCHAR(1200),
    confirmation_status VARCHAR(32) NOT NULL CHECK(confirmation_status IN ('REPORTED','SCHOOL_CONFIRMED')),
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    idempotency_key VARCHAR(128) NOT NULL,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(teacher_id,idempotency_key)
);
CREATE INDEX idx_school_assessments_teacher_date ON school_assessments(teacher_id,exam_date);
CREATE INDEX idx_school_assessments_student_date ON school_assessments(student_id,exam_date);
CREATE TABLE school_assessment_changes (
    id BIGSERIAL PRIMARY KEY,
    assessment_id UUID NOT NULL REFERENCES school_assessments(id) ON DELETE CASCADE,
    old_revision BIGINT NOT NULL,
    old_state JSONB NOT NULL,
    updated_by UUID REFERENCES users(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(assessment_id,old_revision)
);
