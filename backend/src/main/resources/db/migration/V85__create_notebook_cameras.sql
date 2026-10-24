-- QR and reconnect credentials are independent random secrets stored only as SHA-256 hashes.
CREATE TABLE notebook_cameras (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),
    event_id VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id),
    class_id UUID REFERENCES online_classes(id) ON DELETE CASCADE,
    room_name VARCHAR(80) NOT NULL UNIQUE,
    pairing_token_hash VARCHAR(64),
    session_token_hash VARCHAR(64),
    pairing_expires_at TIMESTAMPTZ NOT NULL,
    session_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    room_closed_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY (teacher_id, event_id)
        REFERENCES lesson_history(teacher_id, event_id) ON DELETE CASCADE,
    CHECK (pairing_expires_at > created_at AND session_expires_at > pairing_expires_at)
);
CREATE UNIQUE INDEX uq_notebook_camera_current_owner
    ON notebook_cameras(teacher_id, event_id, owner_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_notebook_camera_active_class ON notebook_cameras(class_id)
    WHERE revoked_at IS NULL;
