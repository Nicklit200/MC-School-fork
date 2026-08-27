ALTER TABLE study_session_items
    ADD COLUMN first_selected_answer TEXT,
    ADD COLUMN first_answer_correct BOOLEAN,
    ADD COLUMN question_snapshot TEXT,
    ADD COLUMN correct_answer_snapshot TEXT;
