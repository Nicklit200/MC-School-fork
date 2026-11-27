-- Per-request accounting for page checks. No prompts, images or raw model responses are stored.
CREATE TABLE kolyn_page_analysis_usage_events (
    id UUID PRIMARY KEY,
    analysis_id UUID NOT NULL REFERENCES kolyn_page_analyses(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id),
    student_id UUID NOT NULL REFERENCES users(id),
    board_id VARCHAR(255) NOT NULL,
    page_number INTEGER NOT NULL CHECK (page_number BETWEEN 1 AND 1000),
    pupil_ink_revision BIGINT NOT NULL CHECK (pupil_ink_revision > 0),
    event_type VARCHAR(24) NOT NULL CHECK (event_type IN
      ('AI_REQUEST','CACHE_HIT','IN_PROGRESS_REUSE','FAILED_REUSE')),
    state VARCHAR(24) NOT NULL DEFAULT 'STARTED' CHECK (state IN
      ('STARTED','SUCCEEDED','USAGE_UNAVAILABLE','FAILED','REUSED')),
    model_name VARCHAR(128),
    response_id VARCHAR(128),
    input_tokens BIGINT CHECK (input_tokens IS NULL OR input_tokens >= 0),
    cached_input_tokens BIGINT CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
    cache_write_tokens BIGINT CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
    output_tokens BIGINT CHECK (output_tokens IS NULL OR output_tokens >= 0),
    reasoning_tokens BIGINT CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
    input_price_usd_per_million NUMERIC(16,8),
    cached_input_price_usd_per_million NUMERIC(16,8),
    cache_write_price_usd_per_million NUMERIC(16,8),
    output_price_usd_per_million NUMERIC(16,8),
    cost_usd NUMERIC(18,10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX idx_kolyn_page_usage_class_student_page
  ON kolyn_page_analysis_usage_events(class_id,teacher_id,student_id,board_id,page_number,created_at);

CREATE INDEX idx_kolyn_page_usage_analysis
  ON kolyn_page_analysis_usage_events(analysis_id,created_at);
