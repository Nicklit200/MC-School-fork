ALTER TABLE homeworks
    ADD COLUMN worksheet_pdf BYTEA,
    ADD COLUMN worksheet_filename VARCHAR(255),
    ADD COLUMN worksheet_page_count INTEGER,
    ADD COLUMN submitted_pdf BYTEA,
    ADD COLUMN submitted_filename VARCHAR(255),
    ADD COLUMN submitted_at TIMESTAMP WITH TIME ZONE;
