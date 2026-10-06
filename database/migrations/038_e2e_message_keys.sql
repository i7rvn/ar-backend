-- Migration 038 : مفاتيح E2E للمستخدمين
CREATE TABLE user_e2e_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  algorithm VARCHAR(40) NOT NULL DEFAULT 'RSA-OAEP-256',
  public_key_jwk JSONB NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_user_e2e_keys_active
  ON user_e2e_keys(user_id)
  WHERE revoked_at IS NULL;

-- Migration 039 : envelopes لمفتاح الرسالة
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS encryption_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS encryption_algorithm VARCHAR(40) NOT NULL DEFAULT 'legacy';

CREATE TABLE message_key_envelopes (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id UUID NOT NULL REFERENCES user_e2e_keys(id) ON DELETE RESTRICT,
  encrypted_message_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, recipient_user_id)
);

CREATE INDEX idx_message_key_envelopes_recipient
  ON message_key_envelopes(recipient_user_id, message_id);

-- الرسائل القديمة لم تعد تستخدم كـpreview نصي قابل للعرض.
UPDATE conversations c
SET last_msg_text = '[رسالة مشفّرة]'
WHERE EXISTS (
  SELECT 1 FROM messages m
  WHERE m.conversation_id = c.id
    AND m.encryption_version >= 1
);
