-- Authorized, privacy-safe diagnostic categories only, never raw browser errors or tokens.
CREATE TABLE IF NOT EXISTS kolyn_lesson_diagnostic_events (
  id UUID PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(40) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kolyn_diagnostic_class_time
  ON kolyn_lesson_diagnostic_events(class_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_kolyn_diagnostic_retention
  ON kolyn_lesson_diagnostic_events(recorded_at);
