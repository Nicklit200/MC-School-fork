ALTER TABLE lesson_preparations
    ADD COLUMN answers_pdf BYTEA,
    ADD COLUMN answers_filename VARCHAR(255);
