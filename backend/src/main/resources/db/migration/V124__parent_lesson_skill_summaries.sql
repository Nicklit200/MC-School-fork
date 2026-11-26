-- School-saved child-specific recap, never the transcript itself.
-- This stays separate from mastery/evidence and is written only after a verified
-- post-lesson review. No parent-facing API may alter it.
ALTER TABLE post_lesson_skill_review_students
  ADD COLUMN IF NOT EXISTS lesson_summary VARCHAR(600);
