ALTER TABLE users ADD COLUMN google_calendar_refresh_token TEXT;
ALTER TABLE users ADD COLUMN google_calendar_oauth_state VARCHAR(120);
ALTER TABLE users ADD COLUMN google_calendar_oauth_state_expires_at TIMESTAMPTZ;
