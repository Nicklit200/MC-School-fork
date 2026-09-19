-- Recording metadata only. Recording bytes live in S3-compatible object
-- storage and are referenced by storage_object_key; never stored as BYTEA.

CREATE TABLE online_class_recordings (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,

    -- Provider Egress identifier. Authoritative completion arrives by webhook.
    egress_id VARCHAR(255),

    status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED'
        CONSTRAINT online_class_recordings_status_check
        CHECK (status IN ('REQUESTED', 'STARTING', 'ACTIVE', 'PROCESSING', 'READY', 'FAILED', 'DELETED')),

    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    storage_object_key VARCHAR(512),
    mime_type VARCHAR(100),
    byte_size BIGINT,
    duration_seconds BIGINT,
    failure_reason VARCHAR(1000),

    -- Retention sweep target; NULL until the recording becomes READY.
    delete_after TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT online_class_recordings_sizes_non_negative CHECK (
        (byte_size IS NULL OR byte_size >= 0)
        AND (duration_seconds IS NULL OR duration_seconds >= 0)
    )
);

-- Webhook reconciliation looks rows up by egress_id; duplicates must collapse.
CREATE UNIQUE INDEX uq_online_class_recordings_egress
    ON online_class_recordings(egress_id) WHERE egress_id IS NOT NULL;
CREATE INDEX idx_online_class_recordings_class
    ON online_class_recordings(class_id, requested_at);
CREATE INDEX idx_online_class_recordings_retention
    ON online_class_recordings(delete_after)
    WHERE delete_after IS NOT NULL AND deleted_at IS NULL;


-- Final transcript segments. Interim captions stay ephemeral in the room and
-- are never written here.
CREATE TABLE online_class_transcript_segments (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,

    -- Stable provider segment identifier, used as the ingestion idempotency
    -- key so retries after a worker reconnect cannot duplicate finals.
    provider_segment_id VARCHAR(255) NOT NULL,

    -- Participant identity as published to the provider; user_id is resolved
    -- when the identity maps to a known application user.
    participant_identity VARCHAR(255),
    user_id UUID REFERENCES users(id),
    speaker_label VARCHAR(120),

    language VARCHAR(20),
    start_ms BIGINT NOT NULL,
    end_ms BIGINT NOT NULL,
    text TEXT NOT NULL,
    confidence DOUBLE PRECISION,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT online_class_transcript_segments_range CHECK (
        start_ms >= 0 AND end_ms >= start_ms
    )
);

CREATE UNIQUE INDEX uq_online_class_transcript_segment_idempotency
    ON online_class_transcript_segments(class_id, provider_segment_id);

-- Ordered playback/export.
CREATE INDEX idx_online_class_transcript_segments_order
    ON online_class_transcript_segments(class_id, start_ms, id);
