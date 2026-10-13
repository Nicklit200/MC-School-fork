-- Independent pilot whiteboard for existing Google Calendar lesson occurrences.
-- Does not modify Google Calendar lessons, homework or any existing tables.
CREATE TABLE lesson_board_operations (
  id BIGSERIAL PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES users(id),
  event_id VARCHAR(255) NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  kind VARCHAR(16) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_board_operation_kind_check
    CHECK (kind IN ('OPEN','STROKE','ERASE','TEXT','CLEAR','UNDO'))
);
CREATE INDEX idx_lesson_board_operations_lesson
  ON lesson_board_operations(teacher_id, event_id, id);
CREATE INDEX idx_lesson_board_operations_actor
  ON lesson_board_operations(actor_id);
