-- Online classes: durable execution of an existing Google Calendar lesson.
-- A class is NOT a second scheduling system; it snapshots the calendar lesson
-- it was materialized from and owns the realtime room for that occurrence.

CREATE TABLE online_classes (
    id UUID PRIMARY KEY,
    teacher_id UUID NOT NULL REFERENCES users(id),

    -- Snapshot of the originating calendar lesson.
    event_id VARCHAR(255) NOT NULL,
    binding_key VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    scheduled_start_at TIMESTAMPTZ NOT NULL,
    scheduled_end_at TIMESTAMPTZ NOT NULL,

    -- Exactly one target, mirroring google_calendar_lesson_bindings (V27).
    student_id UUID REFERENCES users(id),
    group_id UUID REFERENCES student_groups(id),

    -- Opaque provider room name derived from this row's UUID. Never contains
    -- names, e-mail addresses or calendar identifiers.
    room_name VARCHAR(120) NOT NULL,

    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED'
        CONSTRAINT online_classes_status_check
        CHECK (status IN ('SCHEDULED', 'LOBBY_OPEN', 'LIVE', 'ENDED', 'CANCELLED')),

    waiting_room_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    student_screen_share_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    recording_state VARCHAR(20) NOT NULL DEFAULT 'INACTIVE'
        CONSTRAINT online_classes_recording_state_check
        CHECK (recording_state IN ('INACTIVE', 'STARTING', 'ACTIVE', 'STOPPING', 'FAILED')),
    transcription_state VARCHAR(20) NOT NULL DEFAULT 'INACTIVE'
        CONSTRAINT online_classes_transcription_state_check
        CHECK (transcription_state IN ('INACTIVE', 'STARTING', 'ACTIVE', 'STOPPING', 'FAILED')),

    actual_start_at TIMESTAMPTZ,
    actual_end_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT online_classes_exactly_one_target CHECK (
        (student_id IS NOT NULL AND group_id IS NULL)
        OR (student_id IS NULL AND group_id IS NOT NULL)
    ),
    CONSTRAINT online_classes_schedule_order CHECK (scheduled_end_at > scheduled_start_at)
);

-- Opaque room names must be globally unique across the provider.
CREATE UNIQUE INDEX uq_online_classes_room_name ON online_classes(room_name);

-- Prevents duplicate materialization for the same teacher/event occurrence.
-- scheduled_start_at disambiguates occurrences of a recurring event.
CREATE UNIQUE INDEX uq_online_classes_occurrence
    ON online_classes(teacher_id, event_id, scheduled_start_at);

CREATE INDEX idx_online_classes_teacher_start
    ON online_classes(teacher_id, scheduled_start_at);
CREATE INDEX idx_online_classes_student_start
    ON online_classes(student_id, scheduled_start_at) WHERE student_id IS NOT NULL;
CREATE INDEX idx_online_classes_group_start
    ON online_classes(group_id, scheduled_start_at) WHERE group_id IS NOT NULL;


-- One row per (class, user). Survives reconnects: attendance accumulates into
-- total_connected_seconds rather than being derived from a single session.
CREATE TABLE online_class_participants (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),

    -- Application role at join time, snapshotted for post-class reporting.
    class_role VARCHAR(20) NOT NULL
        CONSTRAINT online_class_participants_role_check
        CHECK (class_role IN ('HOST', 'STUDENT')),

    admission_state VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT online_class_participants_admission_check
        CHECK (admission_state IN ('PENDING', 'ADMITTED', 'REJECTED', 'REMOVED')),

    camera_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    microphone_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    screen_share_enabled BOOLEAN NOT NULL DEFAULT FALSE,

    first_joined_at TIMESTAMPTZ,
    last_joined_at TIMESTAMPTZ,
    last_left_at TIMESTAMPTZ,
    total_connected_seconds BIGINT NOT NULL DEFAULT 0,

    recording_ack_at TIMESTAMPTZ,
    transcription_ack_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT online_class_participants_seconds_non_negative
        CHECK (total_connected_seconds >= 0)
);

-- Reconnect-safe: a user has exactly one participant row per class.
CREATE UNIQUE INDEX uq_online_class_participant
    ON online_class_participants(class_id, user_id);
CREATE INDEX idx_online_class_participants_user
    ON online_class_participants(user_id);


-- Waiting room. At most one active (PENDING) request per user per class.
CREATE TABLE online_class_join_requests (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),

    state VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT online_class_join_requests_state_check
        CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED')),

    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TIMESTAMPTZ,
    decided_by UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT online_class_join_requests_decision_complete CHECK (
        (state = 'PENDING' AND decided_at IS NULL AND decided_by IS NULL)
        OR (state <> 'PENDING')
    )
);

-- Idempotent one-active-request behaviour.
CREATE UNIQUE INDEX uq_online_class_join_request_active
    ON online_class_join_requests(class_id, user_id)
    WHERE state = 'PENDING';
CREATE INDEX idx_online_class_join_requests_class_state
    ON online_class_join_requests(class_id, state, requested_at);
