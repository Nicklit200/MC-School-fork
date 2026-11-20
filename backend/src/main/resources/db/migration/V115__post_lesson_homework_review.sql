-- Teacher-only, compact descriptive metadata for reviewing already verified PDFs.
-- No AI chat transcripts, student profile fields, answers, or PDF bytes are duplicated.
ALTER TABLE post_lesson_homework_drafts
    ADD COLUMN review_json TEXT;
ALTER TABLE post_lesson_homework_drafts
    ADD CONSTRAINT post_lesson_homework_draft_review_size
    CHECK (review_json IS NULL OR octet_length(review_json) <= 8192);
