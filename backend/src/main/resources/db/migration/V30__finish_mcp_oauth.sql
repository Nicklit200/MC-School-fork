ALTER TABLE mcp_oauth_authorization_codes
    ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE mcp_oauth_tokens
    ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX idx_mcp_oauth_codes_user ON mcp_oauth_authorization_codes(user_id);
CREATE INDEX idx_mcp_oauth_tokens_user ON mcp_oauth_tokens(user_id);
