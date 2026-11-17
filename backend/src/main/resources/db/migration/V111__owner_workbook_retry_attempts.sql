ALTER TABLE owner_same_day_workbook_jobs
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX owner_same_day_workbook_failed_retry_idx
  ON owner_same_day_workbook_jobs(teacher_id, lesson_date, updated_at)
  WHERE state = 'FAILED';
