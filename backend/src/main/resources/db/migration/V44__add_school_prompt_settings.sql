CREATE TABLE school_prompt_settings (
    id SMALLINT PRIMARY KEY,
    group_lesson_prompt TEXT NOT NULL DEFAULT '',
    individual_lesson_prompt TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT school_prompt_settings_singleton CHECK (id = 1)
);

INSERT INTO school_prompt_settings (id, group_lesson_prompt, individual_lesson_prompt)
VALUES (1, '', '');
