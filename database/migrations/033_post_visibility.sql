-- Migration 033 : مستويات رؤية المنشور
ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'public';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_valid') THEN
    ALTER TABLE posts ADD CONSTRAINT posts_visibility_valid
      CHECK (visibility IN ('public', 'unlisted', 'followers', 'mentioned'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility, created_at DESC) WHERE is_deleted = FALSE;
