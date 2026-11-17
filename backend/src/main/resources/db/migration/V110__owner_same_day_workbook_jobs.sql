-- Exactly one automatic workbook job per teacher and scheduled lesson.
-- Scope is checked in Java: Nick's pilot only, lesson date = Berlin today.
CREATE TABLE owner_same_day_workbook_jobs (
  teacher_id UUID NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  lesson_date DATE NOT NULL,
  state VARCHAR(16) NOT NULL CHECK (state IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  draft_id UUID,
  error_code VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, event_id)
);
CREATE INDEX owner_same_day_workbook_jobs_state_idx
  ON owner_same_day_workbook_jobs (state, lesson_date);
