-- Migration 035 : تفاعلات الرسائل
CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(16) NOT NULL CHECK (reaction IN ('👍','❤️','😂','😢','😡','😮','👎')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, user_id, reaction)
);

CREATE INDEX idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_message_reactions_user ON message_reactions(user_id);
