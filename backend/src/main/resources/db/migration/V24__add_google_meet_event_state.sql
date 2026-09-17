CREATE TABLE google_meet_teacher_event_state (
    teacher_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    google_user_id VARCHAR(255),
    workspace_subscription_name VARCHAR(500),
    subscription_expires_at TIMESTAMPTZ,
    last_left_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_google_meet_workspace_subscription_name
    ON google_meet_teacher_event_state(workspace_subscription_name)
    WHERE workspace_subscription_name IS NOT NULL;
