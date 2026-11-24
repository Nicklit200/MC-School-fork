-- Immutable page-version analysis receipts. Never store image bytes or raw provider responses.
CREATE TABLE kolyn_page_analyses (
    id UUID PRIMARY KEY,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id),
    student_id UUID NOT NULL REFERENCES users(id),
    board_id VARCHAR(255) NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 1000),
    document_version BIGINT NOT NULL CHECK (document_version >= 0),
    shared_document_version BIGINT NOT NULL CHECK (shared_document_version >= 0),
    ink_revision BIGINT NOT NULL CHECK (ink_revision > 0),
    image_sha256 VARCHAR(64) NOT NULL,
    analysis_version INTEGER NOT NULL CHECK (analysis_version > 0),
    state VARCHAR(16) NOT NULL CHECK (state IN ('RUNNING','READY','FAILED')),
    analysis_text TEXT CHECK (char_length(analysis_text) <= 10000),
    failure_code VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    CONSTRAINT uq_kolyn_page_analysis_revision UNIQUE
      (class_id, teacher_id, student_id, board_id, page_number,
       document_version, shared_document_version, ink_revision, analysis_version),
    CHECK ((state='READY') = (analysis_text IS NOT NULL))
);
CREATE INDEX idx_kolyn_page_analyses_pupil
  ON kolyn_page_analyses (class_id, teacher_id, student_id, board_id, page_number);
