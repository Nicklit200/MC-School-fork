ALTER TABLE site_visits
    ADD COLUMN IF NOT EXISTS utm_source VARCHAR(120),
    ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(120),
    ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(240),
    ADD COLUMN IF NOT EXISTS utm_content VARCHAR(240),
    ADD COLUMN IF NOT EXISTS utm_term VARCHAR(240),
    ADD COLUMN IF NOT EXISTS utm_id VARCHAR(160),
    ADD COLUMN IF NOT EXISTS fbclid VARCHAR(500),
    ADD COLUMN IF NOT EXISTS meta_campaign_id VARCHAR(160),
    ADD COLUMN IF NOT EXISTS meta_adset_id VARCHAR(160),
    ADD COLUMN IF NOT EXISTS meta_ad_id VARCHAR(160);

CREATE INDEX IF NOT EXISTS idx_site_visits_utm_campaign ON site_visits (utm_campaign);
CREATE INDEX IF NOT EXISTS idx_site_visits_meta_ad_id ON site_visits (meta_ad_id);
