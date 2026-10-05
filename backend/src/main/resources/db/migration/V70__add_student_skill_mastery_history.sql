CREATE TABLE student_skill_mastery_history (
    id BIGSERIAL PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(64) NOT NULL REFERENCES skill_boards(id) ON DELETE CASCADE,
    skill_id VARCHAR(64) NOT NULL,
    previous_mastery SMALLINT NOT NULL CHECK (previous_mastery >= 0 AND previous_mastery <= 100),
    mastery SMALLINT NOT NULL CHECK (mastery >= 0 AND mastery <= 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID
);

CREATE INDEX idx_student_skill_mastery_history_student_board_time
    ON student_skill_mastery_history(student_id, board_id, updated_at DESC, id DESC);
