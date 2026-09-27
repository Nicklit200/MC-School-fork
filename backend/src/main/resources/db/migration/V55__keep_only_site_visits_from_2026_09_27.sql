-- One-time cleanup requested on 2026-09-27.
-- Keep all visits from 2026-09-27 in Europe/Berlin and newer.
-- site_visit_events are removed via ON DELETE CASCADE; trial_leads are preserved.
DELETE FROM site_visits
WHERE created_at < TIMESTAMPTZ '2026-09-27 00:00:00+02';
