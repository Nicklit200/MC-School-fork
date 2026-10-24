-- Preserve calendar timestamps while allowing a teacher to open a late lesson.
-- Existing rooms retain their original calendar-based expiry.
ALTER TABLE online_classes ADD COLUMN student_join_until TIMESTAMPTZ;
