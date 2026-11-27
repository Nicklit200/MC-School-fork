-- Native Expo push devices belong to a real authenticated account, never a WebView.
CREATE TABLE native_push_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expo_token VARCHAR(256) NOT NULL UNIQUE,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ
);
CREATE INDEX idx_native_push_devices_user_active
    ON native_push_devices(user_id) WHERE disabled_at IS NULL;

-- Separate morning/evening receipts per real child, date, and device.
-- Guarantees one message per slot even if two Railway instances scan at once.
CREATE TABLE parent_homework_mobile_reminder_outbox (
    id UUID PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES native_push_devices(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    homework_day DATE NOT NULL,
    phase VARCHAR(18) NOT NULL CHECK (phase IN ('EVENING','MORNING_MISSED')),
    state VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING','DELIVERING','SENT','SKIPPED','FAILED')),
    attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, student_id, homework_day, phase)
);
CREATE INDEX idx_parent_homework_mobile_pending
    ON parent_homework_mobile_reminder_outbox(next_attempt_at, created_at)
    WHERE state = 'PENDING';
CREATE INDEX idx_parent_homework_mobile_leases
    ON parent_homework_mobile_reminder_outbox(lease_until)
    WHERE state = 'DELIVERING';
