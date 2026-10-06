-- Migration 039 : message encryption metadata and key envelopes
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS encryption_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(40) NOT NULL DEFAULT 'legacy';

CREATE TABLE IF NOT EXISTS message_key_envelopes (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id UUID NOT NULL REFERENCES user_e2e_keys(id) ON DELETE RESTRICT,
  encrypted_message_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_key_envelopes_recipient
  ON message_key_envelopes(recipient_user_id, message_id);

UPDATE conversations c
SET last_msg_text = '[رسالة مشفّرة]'
WHERE EXISTS (
  SELECT 1
  FROM messages m
  WHERE m.conversation_id = c.id
    AND m.encryption_version >= 1
);
