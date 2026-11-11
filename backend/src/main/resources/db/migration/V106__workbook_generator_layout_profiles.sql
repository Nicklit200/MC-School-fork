-- One controlled, versioned layout profile shared by all future school PDF renders.
-- Drafts never affect lessons before a successful render and explicit approval.
CREATE TABLE workbook_generator_layout_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  draft_revision BIGINT NOT NULL DEFAULT 0,
  active_revision BIGINT NOT NULL DEFAULT 0,
  tested_revision BIGINT NOT NULL DEFAULT -1,
  draft_json TEXT NOT NULL,
  active_json TEXT NOT NULL,
  previous_active_json TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO workbook_generator_layout_profiles
  (id, draft_revision, active_revision, tested_revision, draft_json, active_json)
VALUES
  (1, 0, 0, -1,
   '{"schema":"mindcrafti.generator-layout/1","graphHeightMm":68,"graphWidthPercent":100,"graphPlotScalePercent":100,"graphAlignment":"center","blockGapMm":3.6,"answerSpacePercent":100,"taskTitleFontPx":14}',
   '{"schema":"mindcrafti.generator-layout/1","graphHeightMm":68,"graphWidthPercent":100,"graphPlotScalePercent":100,"graphAlignment":"center","blockGapMm":3.6,"answerSpacePercent":100,"taskTitleFontPx":14}');

COMMENT ON TABLE workbook_generator_layout_profiles IS
  'Owner-approved global workbook renderer settings. Draft requires successful QA before activation; last active revision can be restored.';
