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

-- Preserve the known class for pupils who already have an active Grade 8 mastery map.
-- Other pupils stay unset until their class is chosen in the learning profile.
UPDATE users u
SET grade = 8
WHERE u.grade IS NULL
  AND EXISTS (
      SELECT 1
      FROM student_skill_mastery m
      WHERE m.student_id = u.id
        AND m.board_id = 'grade-8-m8'
        AND m.mastery > 0
  );
