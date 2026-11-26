-- Native Expo tokens are scoped to an authenticated school account.
-- Migration intentionally isolated from existing browser Web Push tables.
CREATE TABLE IF NOT EXISTS mobile_push_devices (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expo_push_token varchar(256) NOT NULL UNIQUE,
    platform varchar(16) NOT NULL CHECK (platform IN ('ios', 'android')),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mobile_push_devices_token_format CHECK (expo_push_token LIKE 'ExpoPushToken[%'
        OR expo_push_token LIKE 'ExponentPushToken[%')
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user_id ON mobile_push_devices(user_id);
