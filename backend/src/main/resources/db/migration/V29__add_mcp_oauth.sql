CREATE TABLE mcp_oauth_clients (
    client_id VARCHAR(160) PRIMARY KEY,
    client_name VARCHAR(255),
    redirect_uris TEXT NOT NULL,
    token_endpoint_auth_method VARCHAR(40) NOT NULL DEFAULT 'none',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcp_oauth_authorization_codes (
    code_hash VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(160) NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge VARCHAR(255) NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mcp_oauth_codes_client ON mcp_oauth_authorization_codes(client_id);
CREATE INDEX idx_mcp_oauth_codes_expires ON mcp_oauth_authorization_codes(expires_at);

CREATE TABLE mcp_oauth_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    token_kind VARCHAR(20) NOT NULL,
    client_id VARCHAR(160) NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mcp_oauth_tokens_client ON mcp_oauth_tokens(client_id);
CREATE INDEX idx_mcp_oauth_tokens_expires ON mcp_oauth_tokens(expires_at);
