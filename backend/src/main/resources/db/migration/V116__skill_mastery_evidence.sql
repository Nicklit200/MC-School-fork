-- Immutable, auditable explanations for student skill mastery observations.
-- Historical percentages remain authoritative in student_skill_mastery.
CREATE TABLE IF NOT EXISTS student_skill_evidence (
    id UUID PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(64) NOT NULL REFERENCES skill_boards(id) ON DELETE CASCADE,
    skill_id VARCHAR(128) NOT NULL,
    source_type VARCHAR(24) NOT NULL CHECK (source_type IN ('LESSON','HOMEWORK','TEST','TEACHER_OBSERVATION')),
    source_ref VARCHAR(256) NOT NULL,
    autonomy VARCHAR(24) NOT NULL CHECK (autonomy IN ('FIRST_TRY','INDEPENDENT','HINTED','AFTER_EXPLANATION','NOT_YET','UNKNOWN')),
    explanation VARCHAR(1200) NOT NULL,
    source_excerpt VARCHAR(1200),
    observed_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    mastery_after SMALLINT CHECK (mastery_after BETWEEN 0 AND 100),
    supersedes_id UUID REFERENCES student_skill_evidence(id),
    correction_reason VARCHAR(400),
    idempotency_key VARCHAR(128) NOT NULL,
    CONSTRAINT skill_evidence_unique_submission UNIQUE(student_id,board_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_skill_evidence_student_skill
    ON student_skill_evidence(student_id,board_id,skill_id,observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_evidence_supersedes_once
    ON student_skill_evidence(supersedes_id) WHERE supersedes_id IS NOT NULL;
