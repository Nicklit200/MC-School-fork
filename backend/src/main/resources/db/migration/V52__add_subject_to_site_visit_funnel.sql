ALTER TABLE site_visits
    ADD COLUMN subject VARCHAR(120);

ALTER TABLE site_visit_events
    ADD COLUMN subject VARCHAR(120);
