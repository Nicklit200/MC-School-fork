ALTER TABLE site_visits
    ADD COLUMN diagnostic_stage VARCHAR(40),
    ADD COLUMN first_interaction_label VARCHAR(160),
    ADD COLUMN max_scroll_percent INTEGER,
    ADD COLUMN max_active_seconds INTEGER,
    ADD COLUMN client_error VARCHAR(500),
    ADD COLUMN trial_page_loaded_at TIMESTAMPTZ,
    ADD COLUMN grade_options_visible_at TIMESTAMPTZ,
    ADD COLUMN first_interaction_at TIMESTAMPTZ,
    ADD COLUMN first_scroll_at TIMESTAMPTZ;
