CREATE TABLE IF NOT EXISTS skill_progress_shares (
    id UUID PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_id VARCHAR(64) NOT NULL REFERENCES skill_boards(id) ON DELETE CASCADE,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (student_id, board_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_progress_shares_enabled
    ON skill_progress_shares (enabled, id);
