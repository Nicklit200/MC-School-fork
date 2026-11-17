-- Per-device notification outbox prevents duplicate sends across different devices or server nodes.
-- New error after an explicit retry has a different terminal timestamp.
CREATE TABLE post_lesson_homework_push_outbox (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES post_lesson_homework_jobs(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    event_state VARCHAR(12) NOT NULL
        CHECK (event_state IN ('PUBLISHED', 'FAILED')),
    event_finished_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'DELIVERING', 'SENT', 'SKIPPED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, subscription_id, event_state, event_finished_at)
);

CREATE INDEX post_lesson_homework_push_pending
    ON post_lesson_homework_push_outbox (next_attempt_at, created_at)
    WHERE status = 'PENDING';

CREATE INDEX post_lesson_homework_push_leases
    ON post_lesson_homework_push_outbox (lease_until)
    WHERE status = 'DELIVERING';
