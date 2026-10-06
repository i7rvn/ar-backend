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

-- E2E privacy: replace the legacy conversation preview trigger so ciphertext
-- is never copied into last_msg_text, and keep unread increments centralized
-- in the trigger instead of application code.
CREATE OR REPLACE FUNCTION update_conversation_last_msg()
RETURNS TRIGGER AS $$
BEGIN
 UPDATE conversations
 SET last_msg_at = NEW.created_at,
     last_msg_text = CASE
       WHEN COALESCE(NEW.encryption_version, 1) >= 2 THEN '[رسالة مشفّرة]'
       WHEN NEW.is_deleted THEN '[رسالة محذوفة]'
       ELSE LEFT(NEW.encrypted_content, 50)
     END,
     updated_at = NOW()
 WHERE id = NEW.conversation_id;

 UPDATE conversation_members
 SET unread_count = unread_count + 1
 WHERE conversation_id = NEW.conversation_id
   AND user_id != NEW.sender_id;

 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
