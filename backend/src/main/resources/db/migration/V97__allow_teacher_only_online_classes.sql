-- An existing lesson may be prepared in its modern classroom before a pupil
-- or group is assigned. Such rooms remain accessible only to their teacher;
-- two simultaneous audience targets are still invalid.
ALTER TABLE online_classes
    DROP CONSTRAINT online_classes_exactly_one_target;

ALTER TABLE online_classes
    ADD CONSTRAINT online_classes_at_most_one_target
    CHECK (student_id IS NULL OR group_id IS NULL);
