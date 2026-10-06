-- Migration 031 : Content Warning للمنشورات
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS sensitive_warning TEXT;

UPDATE posts
SET sensitive_warning = NULL
WHERE is_sensitive = FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_sensitive_warning_consistency'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_sensitive_warning_consistency
      CHECK (
        char_length(COALESCE(sensitive_warning, '')) <= 200
        AND (is_sensitive OR sensitive_warning IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_sensitive
  ON posts(is_sensitive)
  WHERE is_sensitive = TRUE;
