-- Preserve the exact roster of a single lesson independently of a recurring group.
-- When manually edited, an empty roster must stay empty on Google refresh.
ALTER TABLE lesson_history
    ADD COLUMN IF NOT EXISTS participants_manually_edited boolean NOT NULL DEFAULT false;
