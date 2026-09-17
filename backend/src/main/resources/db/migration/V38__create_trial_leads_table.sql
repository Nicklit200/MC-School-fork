CREATE TABLE trial_leads (
    id UUID PRIMARY KEY,
    tracking_token UUID NOT NULL UNIQUE,
    phone VARCHAR(40) NOT NULL,
    grade VARCHAR(80),
    school_type VARCHAR(120),
    subject VARCHAR(120),
    goal VARCHAR(500),
    priority VARCHAR(500),
    teacher_id VARCHAR(100),
    teacher_name VARCHAR(160),
    source VARCHAR(500),
    status VARCHAR(40) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trial_leads_created_at ON trial_leads (created_at DESC);
CREATE INDEX idx_trial_leads_phone ON trial_leads (phone);
CREATE INDEX idx_trial_leads_status ON trial_leads (status);
