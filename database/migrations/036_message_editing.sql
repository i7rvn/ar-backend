-- Migration 036 : تعديل الرسائل
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_messages_edited
  ON messages(edited_at)
  WHERE edited_at IS NOT NULL;
