// ═══════════════════════════════════════════════════════════════
// AR App — Posts Service
// ═══════════════════════════════════════════════════════════════

const { query, withTransaction } = require('../../config/database');
const { deleteCache } = require('../../config/redis');
const logger = require('../../config/logger');

// ─── استخراج الهاشتاقات من النص ──────────────────────────────
function extractHashtags(text) {
 const matches = text.match(/#[\u0600-\u06FFa-zA-Z0-9_]+/g) || [];
 return [...new Set(matches.map(h => h.slice(1).toLowerCase()))];
}

// ─── حفظ الهاشتاقات ───────────────────────────────────────────
async function saveHashtags(client, postId, content) {
 const tags = extractHashtags(content);
 for (const tag of tags) {
 // أنشئ الهاشتاق إذا ما موجودش
 const result = await client.query(
 `INSERT INTO hashtags (tag) VALUES ($1)
 ON CONFLICT (tag) DO UPDATE SET updated_at = NOW()
 RETURNING id`,
 [tag]
 );
 await client.query(
 `INSERT INTO post_hashtags (post_id, hashtag_id) VALUES ($1, $2)
 ON CONFLICT DO NOTHING`,
 [postId, result.rows[0].id]
 );
 }
}

// ─── إنشاء منشور ──────────────────────────────────────────────
async function createPost({ userId, content, mediaUrls = [], mediaTypes = [], replyToId, repostOfId, quoteOfId, communityId }) {
 return await withTransaction(async (client) => {
 if (communityId) {
 const membership = await client.query(
 `SELECT user_id FROM community_members WHERE community_id = $1 AND user_id = $2`,
 [communityId, userId]
 );
 if (membership.rows.length === 0) {
 throw { status: 403, message: 'يجب أن تكون عضواً بالمجتمع للنشر فيه' };
 }
 }

 // إذا ريتويت — تحقق من وجود المنشور الأصلي
 if (repostOfId) {
 const orig = await client.query(
 'SELECT id FROM posts WHERE id=$1 AND is_deleted=FALSE', [repostOfId]
 );
 if (!orig.rows.length) throw { status: 404, message: 'المنشور الأصلي غير موجود' };

 // تحقق إذا ريتويتها من قبل
 const exists = await client.query(
 'SELECT id FROM reposts WHERE user_id=$1 AND post_id=$2', [userId, repostOfId]
 );
 if (exists.rows.length) throw { status: 409, message: 'أعدت نشر هذه التغريدة من قبل' };

 await client.query(
 'INSERT INTO reposts (user_id, post_id) VALUES ($1, $2)', [userId, repostOfId]
 );

 const originalOwner = await client.query('SELECT user_id FROM posts WHERE id = $1', [repostOfId]);
 if (originalOwner.rows.length > 0) {
 const { createNotification } = require('../notifications/notifications.service');
 createNotification({ userId: originalOwner.rows[0].user_id, actorId: userId, type: 'repost', postId: repostOfId }).catch(() => {});
 const { awardReputation } = require('../users/reputation.service');
 awardReputation(originalOwner.rows[0].user_id, 'repost').catch(() => {});
 }

 return { reposted: true, postId: repostOfId };
 }

 // منشور عادي
 const result = await client.query(
 `INSERT INTO posts (user_id, content, media_urls, media_types, reply_to_id, quote_of_id, community_id)
 VALUES ($1, $2, $3, $4, $5, $6, $7)
 RETURNING *`,
 [userId, content, mediaUrls, mediaTypes, replyToId || null, quoteOfId || null, communityId || null]
 );

 const post = result.rows[0];
 await saveHashtags(client, post.id, content);

 if (replyToId) {
 const repliedToOwner = await client.query('SELECT user_id FROM posts WHERE id = $1', [replyToId]);
 if (repliedToOwner.rows.length > 0) {
 const { createNotification } = require('../notifications/notifications.service');
 createNotification({ userId: repliedToOwner.rows[0].user_id, actorId: userId, type: 'reply', postId: post.id }).catch(() => {});
 const { awardReputation } = require('../users/reputation.service');
 awardReputation(repliedToOwner.rows[0].user_id, 'reply').catch(() => {});
 }
 }

 if (communityId) {
 const members = await client.query(
 `SELECT user_id FROM community_members WHERE community_id = $1 AND user_id != $2`,
 [communityId, userId]
 );
 const { createNotification } = require('../notifications/notifications.service');
 for (const member of members.rows) {
 createNotification({ userId: member.user_id, actorId: userId, type: 'community_post', postId: post.id }).catch(() => {});
 }
 }

 // مسح cache الفيد
 await deleteCache(`feed:${userId}`);

 return post;
 });
}

// ─── جلب منشور واحد ───────────────────────────────────────────
async function getPost(postId, viewerId = null) {
 const result = await query(
 `SELECT
 p.*,
 u.username, u.display_name, u.avatar_url, u.is_verified,
 ${viewerId ? `
 EXISTS(SELECT 1 FROM likes WHERE user_id=$2 AND post_id=p.id) AS liked_by_me,
 EXISTS(SELECT 1 FROM reposts WHERE user_id=$2 AND post_id=p.id) AS reposted_by_me,
 ` : 'FALSE AS liked_by_me, FALSE AS reposted_by_me,'}
 -- المنشور الأصلي إذا كان ردًا
 rp.content AS reply_to_content,
 ru.username AS reply_to_username,
 ru.display_name AS reply_to_display_name
 FROM posts p
 JOIN users u ON p.user_id = u.id
 LEFT JOIN posts rp ON p.reply_to_id = rp.id
 LEFT JOIN users ru ON rp.user_id = ru.id
 WHERE p.id = $1 AND p.is_deleted = FALSE`,
 viewerId ? [postId, viewerId] : [postId]
 );

 if (!result.rows.length) throw { status: 404, message: 'المنشور غير موجود' };

 // زيادة عداد المشاهدات
 query('UPDATE posts SET views_count = views_count + 1 WHERE id = $1', [postId]).catch(() => {});

 return result.rows[0];
}

// ─── حذف منشور ────────────────────────────────────────────────
async function deletePost(postId, userId, isAdmin = false) {
 const post = await query(
 'SELECT user_id FROM posts WHERE id=$1 AND is_deleted=FALSE', [postId]
 );
 if (!post.rows.length) throw { status: 404, message: 'المنشور غير موجود' };
 if (!isAdmin && post.rows[0].user_id !== userId) {
 throw { status: 403, message: 'لا يمكنك حذف منشور شخص آخر' };
 }

 await query(
 'UPDATE posts SET is_deleted=TRUE, updated_at=NOW() WHERE id=$1', [postId]
 );

 await deleteCache(`feed:${userId}`);
}

// ─── إعجاب / إلغاء إعجاب ─────────────────────────────────────
async function toggleLike(postId, userId) {
  const existing = await query(
    'SELECT id FROM likes WHERE user_id=$1 AND post_id=$2', [userId, postId]
  );

  if (existing.rows.length) {
    await query('DELETE FROM likes WHERE user_id=$1 AND post_id=$2', [userId, postId]);
    return { liked: false };
  } else {
    await query('INSERT INTO likes (user_id, post_id) VALUES ($1,$2)', [userId, postId]);

    const post = await query('SELECT user_id FROM posts WHERE id = $1', [postId]);
    if (post.rows.length > 0) {
      const { createNotification } = require('../notifications/notifications.service');
      createNotification({ userId: post.rows[0].user_id, actorId: userId, type: 'like', postId }).catch(() => {});
      const { awardReputation } = require('../users/reputation.service');
      awardReputation(post.rows[0].user_id, 'like').catch(() => {});
    }

    return { liked: true };
  }
}

// ─── ردود المنشور ─────────────────────────────────────────────
async function getReplies(postId, viewerId = null, page = 1, limit = 20) {
 const offset = (page - 1) * limit;
 const result = await query(
 `SELECT
 p.*,
 u.username, u.display_name, u.avatar_url, u.is_verified
 ${viewerId ? `, EXISTS(SELECT 1 FROM likes WHERE user_id=$3 AND post_id=p.id) AS liked_by_me` : ', FALSE AS liked_by_me'}
 FROM posts p
 JOIN users u ON p.user_id = u.id
 WHERE p.reply_to_id = $1 AND p.is_deleted = FALSE
 ORDER BY p.created_at ASC
 LIMIT $2 OFFSET ${offset}`,
 viewerId ? [postId, limit, viewerId] : [postId, limit]
 );
 return result.rows;
}

module.exports = { createPost, getPost, deletePost, toggleLike, getReplies };
