-- Preserve historical references when a teacher removes a group from active use.
ALTER TABLE student_groups ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;
CREATE INDEX IF NOT EXISTS idx_student_groups_teacher_active
    ON student_groups(teacher_id, name) WHERE archived_at IS NULL;
