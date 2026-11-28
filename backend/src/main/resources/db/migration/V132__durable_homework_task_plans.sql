-- Keep only compiled, per-day worksheet data, not the source transcript or PDFs.
-- An interrupted worker can resume from the existing plan without a paid request.
ALTER TABLE post_lesson_homework_jobs
    ADD COLUMN interruption_retries integer NOT NULL DEFAULT 0 CHECK (interruption_retries >= 0);

CREATE TABLE post_lesson_homework_task_plans (
    job_id uuid NOT NULL REFERENCES post_lesson_homework_jobs(id) ON DELETE CASCADE,
    student_id uuid NOT NULL,
    day_number integer NOT NULL CHECK (day_number BETWEEN 1 AND 7),
    plan_json text NOT NULL CHECK (length(plan_json) BETWEEN 2 AND 500000),
    repair_count integer NOT NULL DEFAULT 0 CHECK (repair_count BETWEEN 0 AND 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, student_id, day_number)
);
