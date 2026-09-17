-- Optional per-card answer time limit (in seconds) that the teacher can set for
-- each flashcard. NULL means the card has no time limit. Enforced in the study UI
-- as a countdown; when it runs out the card is marked as answered incorrectly.
ALTER TABLE cards
    ADD COLUMN time_limit_seconds INTEGER
        CONSTRAINT cards_time_limit_positive CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0);
