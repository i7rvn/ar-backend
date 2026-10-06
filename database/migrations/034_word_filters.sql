-- Migration 034 : فلاتر كلمات المستخدم في الفيد
CREATE TABLE user_word_filters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phrase VARCHAR(80) NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, phrase),
  CHECK (char_length(trim(phrase)) BETWEEN 1 AND 80)
);

CREATE INDEX idx_word_filters_user ON user_word_filters(user_id, expires_at);
