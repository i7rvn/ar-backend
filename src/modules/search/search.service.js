// ═══════════════════════════════════════════════════════════════
// AR App — خدمة البحث (PostgreSQL فقط، بلا Meilisearch)
//
// ملاحظة تصميمية: تم استبدال Meilisearch بالبحث المدمج بـ PostgreSQL
// عبر امتداد pg_trgm (تشابه نصي) لدعم البحث التقريبي بالعربية دون
// الاعتماد على خدمة خارجية منفصلة. الفهرسة عبر GIN index موجودة
// بملف الترحيل 013_search_indexes.sql.
// ═══════════════════════════════════════════════════════════════

const { query } = require('../../config/database');
const { buildVisibilityClause } = require('../posts/postVisibility');

// دالة تبقى موجودة للتوافق مع الاستدعاءات القديمة بـ index.js،
// لا تفعل شيئاً الآن لأن الفهرسة تتم مباشرة بقاعدة البيانات
async function setupMeilisearch() {
  return true;
}

// دالة تبقى موجودة للتوافق، لا حاجة لإضافة توثيق يدوي بفهرس خارجي
async function indexPost() {
  return true;
}

// ─── البحث الرئيسي (PostgreSQL + pg_trgm) ─────────────────────
async function search(q, type = 'all', page = 1, limit = 20, viewerId = null) {
  const offset = (page - 1) * limit;
  const results = { posts: [], users: [], hashtags: [] };

  if (type === 'all' || type === 'posts') {
    const r = await query(
      `SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_verified,
              similarity(p.content, $1) AS relevance
       FROM posts p JOIN users u ON p.user_id = u.id
       WHERE p.content % $1 AND p.is_deleted = FALSE AND u.is_banned = FALSE
       ${viewerId ? buildVisibilityClause(4) : "AND p.visibility = 'public'"}
       ORDER BY relevance DESC, p.likes_count DESC
       LIMIT $2 OFFSET $3`,
      viewerId ? [q, limit, offset, viewerId] : [q, limit, offset]
    );
    results.posts = r.rows;
  }

  if (type === 'all' || type === 'users') {
    const r = await query(
      `SELECT id, username, display_name, avatar_url, is_verified,
              GREATEST(similarity(username, $1), similarity(display_name, $1)) AS relevance
       FROM users
       WHERE (username % $1 OR display_name % $1) AND is_banned = FALSE
       ORDER BY relevance DESC
       LIMIT 5`,
      [q]
    );
    results.users = r.rows;
  }

  if (type === 'all' || type === 'hashtags') {
    const r = await query(
      `SELECT tag, posts_count FROM hashtags
       WHERE tag ILIKE $1
       ORDER BY posts_count DESC LIMIT 5`,
      [`%${q}%`]
    );
    results.hashtags = r.rows;
  }

  return results;
}

module.exports = { setupMeilisearch, indexPost, search };
