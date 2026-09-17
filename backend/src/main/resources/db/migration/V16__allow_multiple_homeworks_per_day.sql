DROP INDEX IF EXISTS uq_homeworks_student_start;

CREATE INDEX IF NOT EXISTS idx_homeworks_student_start
    ON homeworks (student_id, start_date);
