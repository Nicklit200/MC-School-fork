-- Record initial, consented trial-form Lead events through the existing CAPI outbox.
-- Existing events are not backfilled. Keep Meta's test and production records separate.
ALTER TABLE trial_leads
    ADD COLUMN IF NOT EXISTS meta_lead_sent_at TIMESTAMPTZ;

ALTER TABLE trial_lead_meta_conversions
    DROP CONSTRAINT IF EXISTS chk_trial_lead_meta_event;

ALTER TABLE trial_lead_meta_conversions
    ADD CONSTRAINT chk_trial_lead_meta_event
        CHECK (event_name IN ('Lead','Schedule','QualifiedLead','ConvertedLead','ContractSigned'));
