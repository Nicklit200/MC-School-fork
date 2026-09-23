CREATE TABLE site_visits (
    id UUID PRIMARY KEY,
    session_id VARCHAR(80) NOT NULL UNIQUE,
    path VARCHAR(160),
    source VARCHAR(240),
    referrer VARCHAR(240),
    device_type VARCHAR(40),
    device_model VARCHAR(160),
    os_name VARCHAR(80),
    os_version VARCHAR(80),
    browser_name VARCHAR(80),
    browser_version VARCHAR(80),
    screen_size VARCHAR(80),
    viewport_size VARCHAR(80),
    language VARCHAR(40),
    user_agent VARCHAR(500),
    funnel_stage VARCHAR(40),
    grade VARCHAR(80),
    goal VARCHAR(500),
    priority VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_site_visits_created_at ON site_visits (created_at DESC);
