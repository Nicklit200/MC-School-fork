ALTER TABLE lesson_preparations
    ADD COLUMN IF NOT EXISTS transcript_pdf bytea,
    ADD COLUMN IF NOT EXISTS transcript_filename varchar(255);
