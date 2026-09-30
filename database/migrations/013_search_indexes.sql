-- Migration 013 : فهرسة البحث بـ PostgreSQL (بديل Meilisearch)
--
-- امتداد pg_trgm يفعّل البحث بالتشابه النصي (عامل %) وهو مناسب
-- للنص العربي دون الحاجة لتهيئة قاموس لغوي خاص، بعكس امتداد
-- to_tsvector الذي لا يحتوي على تحليل لغوي جاهز للعربية.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_posts_content_trgm
  ON posts USING GIN (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON users USING GIN (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm
  ON users USING GIN (display_name gin_trgm_ops);
