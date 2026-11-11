CREATE TABLE workbook_studio_projects (
    owner_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision > 0),
    project_json TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE workbook_studio_projects IS
    'Private owner-only workbook JSON template collection; never publishes lessons or homework';
