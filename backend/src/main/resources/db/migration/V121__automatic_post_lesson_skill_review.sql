-- One immutable lesson-triggered skill review queue, separate from curriculum edits.
-- The frontend finishes archiving each pupil's annotated PDF before the teacher ends a lesson.
CREATE TABLE post_lesson_skill_review_jobs (
  class_id UUID PRIMARY KEY REFERENCES online_classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id),
  event_id VARCHAR(255) NOT NULL,
  roster_json JSONB NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
    CHECK (state IN ('QUEUED','RUNNING','DONE','PARTIAL','FAILED')),
  total_students INTEGER NOT NULL CHECK(total_students BETWEEN 1 AND 25),
  processed_students INTEGER NOT NULL DEFAULT 0 CHECK(processed_students BETWEEN 0 AND 25),
  attempts INTEGER NOT NULL DEFAULT 0,
  worker_id UUID,
  lease_until TIMESTAMPTZ,
  failure_code VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_post_lesson_skill_review_pending
  ON post_lesson_skill_review_jobs(state,updated_at);

-- A pupil commits all observations atomically. A restart never repeats that pupil.
CREATE TABLE post_lesson_skill_review_students (
  class_id UUID NOT NULL REFERENCES post_lesson_skill_review_jobs(class_id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id),
  board_id VARCHAR(64),
  state VARCHAR(20) NOT NULL
    CHECK(state IN ('RECORDED','NO_EVIDENCE','NO_BOARD','ERROR')),
  observations INTEGER NOT NULL DEFAULT 0,
  mastery_updates INTEGER NOT NULL DEFAULT 0,
  detail VARCHAR(80),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(class_id,student_id)
);
