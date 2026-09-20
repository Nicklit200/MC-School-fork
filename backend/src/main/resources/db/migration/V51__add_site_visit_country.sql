ALTER TABLE site_visits
    ADD COLUMN country_code VARCHAR(2);

CREATE INDEX idx_site_visits_country_created
    ON site_visits (country_code, created_at DESC);
