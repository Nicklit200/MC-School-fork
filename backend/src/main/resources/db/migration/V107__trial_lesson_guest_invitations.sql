-- A one-pupil, one-lesson capability. Never store the plaintext invitation.
ALTER TABLE users ADD COLUMN is_trial_guest BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE trial_lesson_invitations (
  event_id VARCHAR(255) NOT NULL,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  guest_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (teacher_id, event_id),
  CONSTRAINT trial_invitation_claim_pair CHECK ((guest_user_id IS NULL) = (claimed_at IS NULL))
);
CREATE INDEX trial_invitation_guest_user_idx ON trial_lesson_invitations (guest_user_id);
