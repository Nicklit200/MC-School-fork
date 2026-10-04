CREATE TABLE student_skill_mastery (
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(64) NOT NULL REFERENCES skill_boards(id) ON DELETE CASCADE,
    skill_id VARCHAR(64) NOT NULL,
    mastery SMALLINT NOT NULL DEFAULT 0 CHECK (mastery >= 0 AND mastery <= 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID,
    PRIMARY KEY (student_id, board_id, skill_id)
);

CREATE INDEX idx_student_skill_mastery_board_student
    ON student_skill_mastery(board_id, student_id);
