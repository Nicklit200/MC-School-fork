-- Evidence-backed qualitative progress, independent from numerical skill mastery.
-- Re-review older DONE recaps once using previous+current actual lesson data.
ALTER TABLE parent_lesson_recaps
  ADD COLUMN improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN comparison_checked_at TIMESTAMPTZ;
ALTER TABLE parent_lesson_recaps
  ADD CONSTRAINT parent_lesson_improvements_array_check
  CHECK (jsonb_typeof(improvements) = 'array'
     AND octet_length(improvements::text) <= 20000);
CREATE INDEX idx_parent_lesson_recaps_comparison
  ON parent_lesson_recaps(state,comparison_checked_at)
  WHERE state='DONE' AND comparison_checked_at IS NULL;
