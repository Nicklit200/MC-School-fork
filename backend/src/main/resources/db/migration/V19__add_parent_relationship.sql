ALTER TABLE users ADD COLUMN parent_id UUID;

ALTER TABLE users
    ADD CONSTRAINT users_parent_fk
    FOREIGN KEY (parent_id) REFERENCES users(id);

CREATE INDEX users_parent_id_idx ON users(parent_id);
