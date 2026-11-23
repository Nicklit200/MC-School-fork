-- Review checkpoints are teacher-only metadata, not pupil images or copied solutions.
-- One row represents one page successfully inspected by Kolyn at a specific
-- saved ink revision and PDF version.  "Reviewed" does NOT mean "correct".
CREATE TABLE kolyn_review_page_checkpoints (
  class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id VARCHAR(255) NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 1000),
  document_version BIGINT NOT NULL,
  shared_document_version BIGINT NOT NULL DEFAULT -1,
  ink_revision BIGINT NOT NULL,
  image_sha256 VARCHAR(64) NOT NULL,
  page_count INTEGER NOT NULL CHECK (page_count BETWEEN 1 AND 1000),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (class_id, teacher_id, board_id, page_number)
);

-- The private per-lesson conversation survives reloads. No JPEG, PDF, audio,
-- transcript, raw handwriting or access tokens are copied into this table.
CREATE TABLE kolyn_lesson_memory_turns (
  class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID REFERENCES users(id) ON DELETE CASCADE,
  client_message_id UUID NOT NULL,
  question VARCHAR(4000) NOT NULL,
  reply_text VARCHAR(10000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (class_id, teacher_id, client_message_id)
);
CREATE INDEX idx_kolyn_memory_recent
  ON kolyn_lesson_memory_turns(class_id, teacher_id, created_at DESC);
CREATE INDEX idx_kolyn_memory_expiry
  ON kolyn_lesson_memory_turns(created_at);
CREATE INDEX idx_kolyn_memory_pupil_recent
  ON kolyn_lesson_memory_turns(teacher_id, student_id, created_at DESC)
  WHERE student_id IS NOT NULL;
CREATE INDEX idx_kolin_teacher_pupil_review_history
  ON kolin_worksheets(teacher_id,student_id,updated_at DESC)
  WHERE result_type='text' AND student_id IS NOT NULL;
