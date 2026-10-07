// ═══════════════════════════════════════════════════════════════
// AR App — Feed Service (خوارزمية الفيد الذكية)
// ═══════════════════════════════════════════════════════════════

const { query } = require('../../config/database');
const { getCache, setCache } = require('../../config/redis');
const { buildVisibilityClause } = require('../posts/postVisibility');

// ─── الفيد الرئيسي (لأجلك) ────────────────────────────────────
async function getForYouFeed(userId, page = 1, limit = 20) {
 const offset = (page - 1) * limit;
 const cacheKey = `feed:foryou:${userId}:${page}`;
 const cached = await getCache(cacheKey);
 if (cached) return cached;

 const result = await query(
 `SELECT
 p.*,
 u.username, u.display_name, u.avatar_url, u.is_verified,
 EXISTS(SELECT 1 FROM likes WHERE user_id=$1 AND post_id=p.id) AS liked_by_me,
 EXISTS(SELECT 1 FROM reposts WHERE user_id=$1 AND post_id=p.id) AS reposted_by_me,
 EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=p.user_id) AS following_author,
 -- حساب نقاط الخوارزمية
 (
 p.likes_count * 3 +
 p.reposts_count * 5 +
 p.replies_count * 4 +
 p.views_count * 0.1 +
 -- أولوية المتابَعين
 CASE WHEN EXISTS(
 SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=p.user_id
 ) THEN 30 ELSE 0 END +
 -- أولوية المنشورات الحديثة (تنقص بمرور الوقت)
 GREATEST(0, 50 - EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600)
 ) AS score
 FROM posts p
 JOIN users u ON p.user_id = u.id
 WHERE
 p.is_deleted = FALSE
 AND p.reply_to_id IS NULL -- لا ردود في الفيد
 AND p.repost_of_id IS NULL -- لا ريتويت في الفيد
 AND p.created_at > NOW() - INTERVAL '7 days'
 AND u.is_banned = FALSE
 AND (p.user_id = $1 OR p.visibility = 'public' OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id)) OR (p.visibility = 'mentioned' AND EXISTS (SELECT 1 FROM regexp_matches(p.content, '@([A-Za-z0-9_\\u0600-\\u06FF]+)', 'g') AS mention(match) WHERE lower(mention.match[1]) = (SELECT lower(u2.username) FROM users u2 WHERE u2.id = $1))))
 AND NOT EXISTS (SELECT 1 FROM user_word_filters wf WHERE wf.user_id = $1 AND (wf.expires_at IS NULL OR wf.expires_at > NOW()) AND strpos(lower(p.content), wf.phrase) > 0)
 AND NOT EXISTS ( -- استثناء ثنائي الاتجاه: أنا حاظره أو هو حاظرني
   SELECT 1 FROM user_blocks b
   WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id)
      OR (b.blocker_id = p.user_id AND b.blocked_id = $1)
 )
 AND NOT EXISTS ( -- الكتم: اتجاه واحد فقط (أنا كتمته) — هو ما يعرفش ولا يتأثر
   SELECT 1 FROM user_mutes m WHERE m.muter_id = $1 AND m.muted_id = p.user_id
 )
 ORDER BY score DESC, p.created_at DESC
 LIMIT $2 OFFSET $3`,
 [userId, limit, offset]
 );

 await setCache(cacheKey, result.rows, 60); // دقيقة واحدة
 return result.rows;
}

// ─── فيد المتابَعين ────────────────────────────────────────────
async function getFollowingFeed(userId, page = 1, limit = 20) {
 const offset = (page - 1) * limit;
 const cacheKey = `feed:following:${userId}:${page}`;
 const cached = await getCache(cacheKey);
 if (cached) return cached;

 const result = await query(
 `SELECT
 p.*,
 u.username, u.display_name, u.avatar_url, u.is_verified,
 EXISTS(SELECT 1 FROM likes WHERE user_id=$1 AND post_id=p.id) AS liked_by_me,
 EXISTS(SELECT 1 FROM reposts WHERE user_id=$1 AND post_id=p.id) AS reposted_by_me,
 TRUE AS following_author
 FROM posts p
 JOIN users u ON p.user_id = u.id
 WHERE
 p.user_id IN (
 SELECT following_id FROM follows WHERE follower_id = $1
 )
 AND p.is_deleted = FALSE
 AND p.reply_to_id IS NULL
 AND u.is_banned = FALSE
 AND NOT EXISTS (SELECT 1 FROM user_word_filters wf WHERE wf.user_id = $1 AND (wf.expires_at IS NULL OR wf.expires_at > NOW()) AND p.content ILIKE '%' || wf.phrase || '%')
 AND NOT EXISTS ( -- الحظر يزيل المتابعة تلقائياً بالباك اند، لكن هذا حزام أمان إضافي
   SELECT 1 FROM user_blocks b
   WHERE (b.blocker_id = $1 AND b.blocked_id = p.user_id)
      OR (b.blocker_id = p.user_id AND b.blocked_id = $1)
 )
 AND (p.user_id = $1 OR p.visibility = 'public' OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id)) OR (p.visibility = 'mentioned' AND EXISTS (SELECT 1 FROM regexp_matches(p.content, '@([A-Za-z0-9_\\u0600-\\u06FF]+)', 'g') AS mention(match) WHERE lower(mention.match[1]) = (SELECT lower(u2.username) FROM users u2 WHERE u2.id = $1))))
 AND NOT EXISTS (
   SELECT 1 FROM user_mutes m WHERE m.muter_id = $1 AND m.muted_id = p.user_id
 )
 ORDER BY p.created_at DESC
 LIMIT $2 OFFSET $3`,
 [userId, limit, offset]
 );

 await setCache(cacheKey, result.rows, 30);
 return result.rows;
}

// ─── فيد الرائج ────────────────────────────────────────────────
// viewerId اختياري (الفيد عام، يشوفه زوّار بلا تسجيل دخول أيضاً) —
// إذا موجود، نستثني منه/منه أي محتوى بينهم حظر متبادل
async function getTrendingFeed(page = 1, limit = 20, viewerId = null) {
 const offset = (page - 1) * limit;
 const cacheKey = `feed:trending:${page}:${viewerId || 'guest'}`;
 const cached = await getCache(cacheKey);
 if (cached) return cached;

 const blockCondition = viewerId
   ? `AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
       WHERE (b.blocker_id = $3 AND b.blocked_id = p.user_id)
          OR (b.blocker_id = p.user_id AND b.blocked_id = $3)
     )`
   : '';
 const params = viewerId ? [limit, offset, viewerId] : [limit, offset];

 const result = await query(
 `SELECT
 p.*,
 u.username, u.display_name, u.avatar_url, u.is_verified,
 FALSE AS liked_by_me,
 FALSE AS reposted_by_me,
 (p.likes_count * 3 + p.reposts_count * 5 + p.replies_count * 4) AS score
 FROM posts p
 JOIN users u ON p.user_id = u.id
 WHERE
 p.is_deleted = FALSE
 AND p.reply_to_id IS NULL
 AND p.created_at > NOW() - INTERVAL '48 hours'
 AND u.is_banned = FALSE
 ${viewerId ? "AND (p.user_id = $3 OR p.visibility = 'public' OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $3 AND f.following_id = p.user_id)) OR (p.visibility = 'mentioned' AND EXISTS (SELECT 1 FROM regexp_matches(p.content, '@([A-Za-z0-9_\\u0600-\\u06FF]+)', 'g') AS mention(match) WHERE lower(mention.match[1]) = (SELECT lower(u2.username) FROM users u2 WHERE u2.id = $3))))" : "AND p.visibility = 'public'"}
 ${viewerId ? `AND NOT EXISTS (SELECT 1 FROM user_word_filters wf WHERE wf.user_id = $3 AND (wf.expires_at IS NULL OR wf.expires_at > NOW()) AND p.content ILIKE '%' || wf.phrase || '%')` : ''}
 ${blockCondition}
 ORDER BY score DESC, p.created_at DESC
 LIMIT $1 OFFSET $2`,
 params
 );

 // كاش أقصر للزوّار المسجّلين (نتائج مخصّصة حسب حظرهم) ماشي 5 دقائق كاملة
 await setCache(cacheKey, result.rows, viewerId ? 60 : 300);
 return result.rows;
}

// ─── منشورات مستخدم ────────────────────────────────────────────
async function getUserPosts(targetUserId, viewerId = null, page = 1, limit = 20, type = 'posts') {
  const offset = (page - 1) * limit;
  const viewerSelect = viewerId
    ? `, EXISTS(SELECT 1 FROM likes WHERE user_id=$3 AND post_id=p.id) AS liked_by_me,
         EXISTS(SELECT 1 FROM reposts WHERE user_id=$3 AND post_id=p.id) AS reposted_by_me`
    : ', FALSE AS liked_by_me, FALSE AS reposted_by_me';
  const params = viewerId ? [targetUserId, limit, viewerId] : [targetUserId, limit];

  const targetProfile = await query('SELECT is_private FROM users WHERE id = $1 AND is_banned = FALSE', [targetUserId]);
  if (!targetProfile.rows.length) return [];
  if (targetProfile.rows[0].is_private && viewerId !== targetUserId) {
    if (!viewerId) return [];
    const following = await query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [viewerId, targetUserId]);
    if (!following.rows.length) return [];
  }
  // إذا الزائر محظور من صاحب البروفايل أو العكس، ما يشوف حتى منشور واحد
  if (viewerId) {
    const blocked = await query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
      [viewerId, targetUserId]
    );
    if (blocked.rows.length > 0) return [];
  }

  let whereAndJoin;
  let orderBy = 'p.created_at DESC';

  if (type === 'replies') {
    whereAndJoin = `WHERE p.user_id=$1 AND p.is_deleted=FALSE AND p.reply_to_id IS NOT NULL`;
  } else if (type === 'likes') {
    whereAndJoin = `JOIN likes l ON l.post_id = p.id
      WHERE l.user_id=$1 AND p.is_deleted=FALSE`;
    orderBy = 'l.created_at DESC';
  } else {
    whereAndJoin = `WHERE p.user_id=$1 AND p.is_deleted=FALSE AND p.reply_to_id IS NULL`;
    orderBy = 'p.is_pinned DESC, p.created_at DESC'; // المثبّت دايماً فوق، بلا اعتبار تاريخه
  }

  const result = await query(
    `SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_verified ${viewerSelect}
     FROM posts p
     JOIN users u ON p.user_id = u.id
     ${whereAndJoin}
     ${viewerId ? "AND (p.user_id = $3 OR p.visibility = 'public' OR p.visibility = 'unlisted' OR (p.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $3 AND f.following_id = p.user_id)) OR (p.visibility = 'mentioned' AND EXISTS (SELECT 1 FROM regexp_matches(p.content, '@([A-Za-z0-9_\\u0600-\\u06FF]+)', 'g') AS mention(match) WHERE lower(mention.match[1]) = (SELECT lower(u2.username) FROM users u2 WHERE u2.id = $3))))" : "AND p.visibility = 'public'"}
     ORDER BY ${orderBy}
     LIMIT $2 OFFSET ${offset}`,
    params
  );

  return result.rows;
}

module.exports = { getForYouFeed, getFollowingFeed, getTrendingFeed, getUserPosts };
