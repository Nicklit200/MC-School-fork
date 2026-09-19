-- Shared whiteboard / screen-share annotation surfaces.
--
-- NOTEBOOK_CAMERA is present in the target_type enum from day one so the later
-- phone-published notebook track is an additional target value rather than a
-- redesign of the class model. Nothing writes it in this release.

CREATE TABLE online_class_annotation_documents (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,

    target_type VARCHAR(20) NOT NULL
        CONSTRAINT online_class_annotation_documents_target_check
        CHECK (target_type IN ('WHITEBOARD', 'SCREEN_SHARE', 'NOTEBOOK_CAMERA')),

    -- Identifies the annotated surface: whiteboard page key, or the published
    -- track identifier for a screen share.
    target_id VARCHAR(255) NOT NULL,
    page_index INTEGER NOT NULL DEFAULT 0,

    -- Coordinates are normalized to the target surface (0..1), never CSS
    -- pixels. Source dimensions are retained so a late joiner can reproduce
    -- the original aspect ratio.
    source_width INTEGER,
    source_height INTEGER,

    -- Monotonic revision; every accepted operation increments it.
    revision BIGINT NOT NULL DEFAULT 0,

    -- Latest flattened snapshot in object storage, when one has been saved.
    snapshot_object_key VARCHAR(512),
    snapshot_saved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT online_class_annotation_documents_page_non_negative
        CHECK (page_index >= 0),
    CONSTRAINT online_class_annotation_documents_dimensions CHECK (
        (source_width IS NULL OR source_width > 0)
        AND (source_height IS NULL OR source_height > 0)
    )
);

CREATE UNIQUE INDEX uq_online_class_annotation_document
    ON online_class_annotation_documents(class_id, target_type, target_id, page_index);


CREATE TABLE online_class_annotation_events (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES online_class_annotation_documents(id) ON DELETE CASCADE,

    -- Client-generated operation identifier; makes realtime delivery and
    -- backend persistence de-duplicable against each other.
    operation_id UUID NOT NULL,

    -- Position within the document's ordered revision stream.
    sequence BIGINT NOT NULL,

    actor_id UUID NOT NULL REFERENCES users(id),

    -- Layer ownership drives per-layer visibility and "clear my layer".
    layer_owner_id UUID NOT NULL REFERENCES users(id),

    operation_type VARCHAR(20) NOT NULL
        CONSTRAINT online_class_annotation_events_type_check
        CHECK (operation_type IN ('ADD', 'UPDATE', 'ERASE', 'CLEAR_LAYER', 'CLEAR_ALL')),

    -- Validated, normalized shape payload. Size is bounded by the application
    -- layer before insert; the column cap is a backstop.
    payload VARCHAR(16384) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT online_class_annotation_events_sequence_positive CHECK (sequence > 0)
);

CREATE UNIQUE INDEX uq_online_class_annotation_event_idempotency
    ON online_class_annotation_events(document_id, operation_id);
CREATE UNIQUE INDEX uq_online_class_annotation_event_sequence
    ON online_class_annotation_events(document_id, sequence);

-- Late join / reconnect replays from a known revision forward.
CREATE INDEX idx_online_class_annotation_events_replay
    ON online_class_annotation_events(document_id, sequence);
CREATE INDEX idx_online_class_annotation_events_layer
    ON online_class_annotation_events(document_id, layer_owner_id);
