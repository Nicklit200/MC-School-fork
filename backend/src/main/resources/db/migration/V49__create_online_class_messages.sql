-- Persistent class chat. LiveKit's prefab chat is non-persistent, so the
-- backend is the source of truth and realtime delivery is de-duplicated
-- against these rows by client_message_id.

CREATE TABLE online_class_messages (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),

    -- Client-generated idempotency key; lets a retried send collapse onto the
    -- original row instead of duplicating it.
    client_message_id UUID NOT NULL,

    -- Sanitized plain text. Never rendered as HTML.
    body VARCHAR(2000) NOT NULL,

    -- SYSTEM messages (joins/leaves/recording state) are server-authored only;
    -- clients cannot forge them because message_type is never client-supplied.
    message_type VARCHAR(20) NOT NULL DEFAULT 'USER'
        CONSTRAINT online_class_messages_type_check
        CHECK (message_type IN ('USER', 'SYSTEM')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),

    version BIGINT NOT NULL DEFAULT 0,

    -- A live message must carry content; a soft-deleted one has its body
    -- cleared while the row is retained for audit.
    CONSTRAINT online_class_messages_body_not_blank
        CHECK (deleted_at IS NOT NULL OR length(btrim(body)) > 0)
);

-- Idempotent retries: the same client_message_id in the same class is one row.
CREATE UNIQUE INDEX uq_online_class_messages_idempotency
    ON online_class_messages(class_id, client_message_id);

-- Chronological cursor pagination. id breaks ties for same-instant rows.
CREATE INDEX idx_online_class_messages_class_created
    ON online_class_messages(class_id, created_at, id);
