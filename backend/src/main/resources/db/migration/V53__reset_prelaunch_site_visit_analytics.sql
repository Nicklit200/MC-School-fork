-- Clear pre-launch/test traffic so public funnel analytics starts from a clean baseline.
-- site_visit_events are removed automatically by ON DELETE CASCADE.
-- trial_leads are intentionally preserved.
DELETE FROM site_visits;
