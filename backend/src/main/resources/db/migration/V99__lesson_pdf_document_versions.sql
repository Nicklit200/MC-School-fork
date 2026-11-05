ALTER TABLE lesson_preparations
    ADD COLUMN workbook_version BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN answers_version BIGINT NOT NULL DEFAULT 0;

UPDATE lesson_preparations
SET workbook_version = CASE WHEN octet_length(workbook_pdf) > 0 THEN 1 ELSE 0 END,
    answers_version = CASE WHEN octet_length(answers_pdf) > 0 THEN 1 ELSE 0 END;
