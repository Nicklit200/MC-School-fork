-- Review checkpoints are teacher-only metadata, not pupil images or copied solutions.
-- One row represents one page successfully inspected by Kolyn at a specific
-- saved ink revision and PDF version.  "Reviewed" does NOT mean "correct".
CREATE TABLE kolyn_review_page_checkpoints (
  class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id VARCHAR(255) NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 1000),
  document_version BIGINT NOT NULL,
  ink_revision BIGINT NOT NULL,
  image_sha256 VARCHAR(64) NOT NULL,
  page_count INTEGER NOT NULL CHECK (page_count BETWEEN 1 AND 1000),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (class_id, teacher_id, board_id, page_number)
);
