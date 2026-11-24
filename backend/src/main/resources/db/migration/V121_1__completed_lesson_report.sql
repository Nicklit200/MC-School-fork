-- Manual, teacher-only report previews. No changes to lesson archives, homework or mastery.
CREATE TABLE completed_lesson_report_jobs (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id),
    student_id UUID NOT NULL REFERENCES users(id),
    teacher_focus VARCHAR(3000) NOT NULL DEFAULT '',
    state VARCHAR(16) NOT NULL DEFAULT 'QUEUED'
        CHECK (state IN ('QUEUED','RUNNING','DONE','FAILED')),
    result_json JSONB,
    failure_code VARCHAR(80),
    worker_id UUID,
    lease_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
-- One paid manual report at a time per teacher, even across browsers and replicas.
CREATE UNIQUE INDEX idx_completed_lesson_report_active_teacher
    ON completed_lesson_report_jobs(teacher_id) WHERE state IN ('QUEUED','RUNNING');
CREATE INDEX idx_completed_lesson_report_pending
    ON completed_lesson_report_jobs(state,created_at);
CREATE INDEX idx_completed_lesson_report_history
    ON completed_lesson_report_jobs(class_id,teacher_id,student_id,created_at DESC);
