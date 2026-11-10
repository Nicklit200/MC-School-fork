-- Administrator-managed handbook content, shared by the website and MCH3.
-- The packaged guide remains the safe read-only fallback until an article is published.
CREATE TABLE teacher_help_articles (
    article_id varchar(80) PRIMARY KEY,
    draft_json text,
    published_json text,
    revision bigint NOT NULL DEFAULT 0,
    published_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT teacher_help_articles_has_content CHECK (draft_json IS NOT NULL OR published_json IS NOT NULL)
);

CREATE TABLE teacher_help_history (
    id bigserial PRIMARY KEY,
    article_id varchar(80) NOT NULL REFERENCES teacher_help_articles(article_id) ON DELETE CASCADE,
    revision bigint NOT NULL,
    published_json text NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (article_id, revision)
);

CREATE TABLE teacher_help_images (
    image_id varchar(80) PRIMARY KEY,
    meta_json text NOT NULL,
    mime_type varchar(32) NOT NULL,
    image_data bytea NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);
