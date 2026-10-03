ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_lesson_pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS ai_preparation_time VARCHAR(5) NOT NULL DEFAULT '10:00';

UPDATE users
SET ai_lesson_pilot_enabled = TRUE,
    ai_preparation_time = COALESCE(NULLIF(ai_preparation_time, ''), '10:00')
WHERE id = '14e3c7c1-1fc8-41bd-858a-6c20efdd957a';
