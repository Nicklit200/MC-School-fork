CREATE TABLE IF NOT EXISTS trial_lead_meta_conversions (
    lead_id UUID NOT NULL REFERENCES trial_leads(id) ON DELETE CASCADE,
    event_name VARCHAR(40) NOT NULL DEFAULT 'ContractSigned',
    event_id VARCHAR(160) NOT NULL UNIQUE,
    occurred_at TIMESTAMPTZ NOT NULL,
    permission_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'SENDING',
    sent_at TIMESTAMPTZ,
    last_error VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lead_id, event_name),
    CONSTRAINT chk_trial_lead_meta_event CHECK (event_name IN ('ContractSigned')),
    CONSTRAINT chk_trial_lead_meta_status CHECK (status IN ('SENDING','TEST_SENT','SENT','FAILED'))
);
CREATE INDEX IF NOT EXISTS idx_trial_meta_status ON trial_lead_meta_conversions(status);
