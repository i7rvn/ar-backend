-- Migration 030 : كتم عضو بمجتمع (منعه من النشر مؤقتاً بدون طرده)
--
-- muted_until = NULL يعني غير مكتوم. الكتم مؤقت دائماً بتاريخ انتهاء
-- صريح (ينتهي تلقائياً بلا حاجة لمهمة تنظيف) — يفرضه createPost فعلياً.

ALTER TABLE community_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
