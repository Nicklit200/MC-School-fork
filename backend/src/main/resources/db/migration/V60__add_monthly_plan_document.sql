ALTER TABLE monthly_plans
    ADD COLUMN document_filename VARCHAR(255),
    ADD COLUMN document_content_type VARCHAR(255),
    ADD COLUMN document_data BYTEA;
