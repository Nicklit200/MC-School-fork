-- Score a validated skill improvement at most once. Provenance stays in the
-- existing student_skill_evidence / student_skill_mastery_history tables.
ALTER TABLE parent_lesson_recaps
  ADD COLUMN IF NOT EXISTS scoring_checked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_parent_lesson_recaps_pending_score
  ON parent_lesson_recaps(state, scoring_checked_at)
  WHERE state='DONE' AND scoring_checked_at IS NULL;
