-- Students may be created before an email address is known.
-- The email is collected when an invitation without email is activated.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
