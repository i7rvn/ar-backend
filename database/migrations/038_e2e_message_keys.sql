-- Migration 038 : مفاتيح E2E للمستخدمين
CREATE TABLE user_e2e_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  algorithm VARCHAR(40) NOT NULL DEFAULT 'RSA-OAEP-256',
  public_key_jwk JSONB NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_user_e2e_keys_one_active
  ON user_e2e_keys(user_id)
  WHERE revoked_at IS NULL;
