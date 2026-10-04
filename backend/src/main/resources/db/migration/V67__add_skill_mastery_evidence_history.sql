CREATE TABLE student_skill_mastery_history (
    id BIGSERIAL PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(64) NOT NULL REFERENCES skill_boards(id) ON DELETE CASCADE,
    skill_id VARCHAR(64) NOT NULL,
    old_mastery SMALLINT CHECK (old_mastery IS NULL OR (old_mastery >= 0 AND old_mastery <= 100)),
    new_mastery SMALLINT NOT NULL CHECK (new_mastery >= 0 AND new_mastery <= 100),
    reason TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by UUID
);

CREATE INDEX idx_skill_mastery_history_student_board_skill
    ON student_skill_mastery_history(student_id, board_id, skill_id, changed_at DESC);

INSERT INTO student_skill_mastery_history(
    student_id, board_id, skill_id, old_mastery, new_mastery,
    reason, evidence, manual_override, changed_at, changed_by
)
SELECT
    student_id, board_id, skill_id, NULL, mastery,
    'Legacy value created before evidence tracking. Evidence must be attached before this percentage is treated as verified.',
    '[]'::jsonb, TRUE, updated_at, updated_by
FROM student_skill_mastery;
