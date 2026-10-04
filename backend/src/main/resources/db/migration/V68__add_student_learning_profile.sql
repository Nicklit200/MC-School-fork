ALTER TABLE users
    ADD COLUMN grade INTEGER,
    ADD COLUMN school_type VARCHAR(40),
    ADD COLUMN learning_pace VARCHAR(20),
    ADD COLUMN learning_strengths TEXT,
    ADD COLUMN learning_difficulties TEXT,
    ADD COLUMN explanation_style TEXT,
    ADD COLUMN learning_notes TEXT;

ALTER TABLE users
    ADD CONSTRAINT chk_users_grade_range
    CHECK (grade IS NULL OR (grade >= 1 AND grade <= 13));
