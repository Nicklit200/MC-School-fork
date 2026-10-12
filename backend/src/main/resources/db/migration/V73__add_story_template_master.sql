-- One private, administrator-controlled source of truth for the three Mindcrafti Stories slides.
-- Keep PPTX bytes in PostgreSQL, not in the public website assets or public Git repository.
CREATE TABLE story_template_master (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    filename VARCHAR(255),
    pptx_data BYTEA,
    sha256 CHAR(64),
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO story_template_master (id, version, updated_at) VALUES (1, 0, NOW());
