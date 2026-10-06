-- Migration 037 : تثبيت رسائل المحادثات
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_pinned
  ON messages(conversation_id, pinned_at DESC)
  WHERE is_pinned = TRUE;
