ALTER TABLE trial_leads
    ADD COLUMN client_id VARCHAR(80);

CREATE UNIQUE INDEX ux_trial_leads_client_id
    ON trial_leads (client_id)
    WHERE client_id IS NOT NULL;
