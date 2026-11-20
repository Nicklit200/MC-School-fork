-- Fixed stage/day metadata survives a failed run or a backend restart.
-- No prompts, transcripts, model responses or PDF contents are stored here.
ALTER TABLE post_lesson_homework_jobs
    ADD COLUMN generation_stage VARCHAR(32),
    ADD COLUMN day_number SMALLINT;

ALTER TABLE post_lesson_homework_jobs
    ADD CONSTRAINT post_lesson_homework_job_stage_check CHECK (
        generation_stage IS NULL OR generation_stage IN (
            'RECIPIENT_SELECTION', 'LESSON_EVIDENCE', 'AI_CONTENT',
            'CONTENT_VALIDATION', 'PDF_RENDER', 'PDF_STORAGE', 'PUBLICATION'
        )
    ),
    ADD CONSTRAINT post_lesson_homework_job_day_check CHECK (
        day_number IS NULL OR day_number BETWEEN 1 AND 7
    );
