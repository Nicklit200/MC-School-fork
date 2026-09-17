ALTER TABLE users ADD COLUMN username VARCHAR(60);

CREATE UNIQUE INDEX ux_users_username_lower
    ON users (LOWER(username))
    WHERE username IS NOT NULL;
