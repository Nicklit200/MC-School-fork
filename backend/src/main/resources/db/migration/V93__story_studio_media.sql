CREATE TABLE story_studio_media (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    studio_version BIGINT NOT NULL CHECK (studio_version > 0),
    story_number SMALLINT NOT NULL CHECK (story_number BETWEEN 1 AND 3),
    sha256 VARCHAR(64) NOT NULL,
    png_bytes BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_studio_media_owner_version ON story_studio_media(owner_id, studio_version, story_number, created_at DESC);
CREATE INDEX idx_studio_media_expiry ON story_studio_media(expires_at);
