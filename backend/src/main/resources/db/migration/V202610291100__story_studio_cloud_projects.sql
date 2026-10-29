CREATE TABLE story_studio_projects (
    owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision > 0),
    project_json TEXT NOT NULL,
    sha256 VARCHAR(64) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE story_studio_projects IS 'Private per-admin HTML/CSS/JSON Stories Studio projects; not the legacy PPTX master';
