CREATE TABLE site_visit_events (
    id UUID PRIMARY KEY,
    visit_id UUID NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
    session_id VARCHAR(80) NOT NULL,
    event VARCHAR(40) NOT NULL,
    path VARCHAR(160),
    grade VARCHAR(80),
    goal VARCHAR(500),
    priority VARCHAR(500),
    scroll_percent INTEGER,
    active_seconds INTEGER,
    interaction_label VARCHAR(160),
    section_id VARCHAR(80),
    section_label VARCHAR(160),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_site_visit_events_session_created
    ON site_visit_events (session_id, created_at);

CREATE INDEX idx_site_visit_events_event_created
    ON site_visit_events (event, created_at DESC);
