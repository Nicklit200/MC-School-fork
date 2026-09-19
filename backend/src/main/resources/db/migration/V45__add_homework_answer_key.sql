ALTER TABLE homeworks
    ADD COLUMN IF NOT EXISTS final_answer_count INTEGER,
    ADD COLUMN IF NOT EXISTS answer_key_json TEXT;
