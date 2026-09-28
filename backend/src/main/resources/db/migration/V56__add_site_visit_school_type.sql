ALTER TABLE site_visits
    ADD COLUMN school_type VARCHAR(120);

ALTER TABLE site_visit_events
    ADD COLUMN school_type VARCHAR(120);
