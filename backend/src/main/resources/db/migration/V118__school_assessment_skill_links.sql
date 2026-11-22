-- Exact exam-to-skill links; dynamic mastery percentages are NEVER copied here.
-- A not-yet-mapped announced topic remains explicit and excluded from the average.
ALTER TABLE school_assessments
  ADD COLUMN board_id VARCHAR(128),
  ADD COLUMN skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN unmapped_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN topic_skill_ids JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE school_assessments
  ADD CONSTRAINT school_assessments_skill_ids_array CHECK (jsonb_typeof(skill_ids)='array'),
  ADD CONSTRAINT school_assessments_unmapped_topics_array CHECK (jsonb_typeof(unmapped_topics)='array'),
  ADD CONSTRAINT school_assessments_topic_skill_ids_object CHECK (jsonb_typeof(topic_skill_ids)='object');
