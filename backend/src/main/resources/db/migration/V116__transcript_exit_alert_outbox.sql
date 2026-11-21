-- Server-side, one-per-room transcript audit. Rows are queued only when the
-- owning teacher presses Leave or End for all; no ChatGPT schedule is involved.
-- Status SENT is retained to prevent duplicate owner e-mails.
CREATE TABLE online_class_transcript_exit_alerts (
    class_id UUID PRIMARY KEY REFERENCES online_classes(id) ON DELETE CASCADE,
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'OK', 'SKIPPED', 'SENT')),
    check_after TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    checked_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transcript_exit_alerts_due
    ON online_class_transcript_exit_alerts(check_after)
    WHERE status = 'PENDING';
