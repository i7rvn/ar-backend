const express = require('express');
const { query } = require('../../config/database');
const { getCache, setCache } = require('../../config/redis');
const { respond, asyncHandler } = require('../../utils/helpers');

const router = express.Router();

// ─── الهاشتاقات الرائجة ───────────────────────────────────────
router.get('/trending', asyncHandler(async (req, res) => {
 const cached = await getCache('hashtags:trending');
 if (cached) return respond.ok(res, cached);

 const result = await query(
 `SELECT h.tag, h.posts_count,
 COUNT(DISTINCT ph.post_id) AS recent_posts
 FROM hashtags h
 JOIN post_hashtags ph ON h.id = ph.hashtag_id
 JOIN posts p ON ph.post_id = p.id
 WHERE p.created_at > NOW() - INTERVAL '24 hours'
 AND p.is_deleted = FALSE
 GROUP BY h.id, h.tag, h.posts_count
 ORDER BY recent_posts DESC, h.posts_count DESC
 LIMIT 10`
 );

 await setCache('hashtags:trending', result.rows, 300); // 5 دقائق
 respond.ok(res, result.rows);
}));

// ─── منشورات هاشتاق معين ──────────────────────────────────────
router.get('/:tag', asyncHandler(async (req, res) => {
 const tag = req.params.tag.toLowerCase().replace('#', '');
 const limit = parseInt(req.query.limit) || 20;
 const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

 const result = await query(
 `SELECT
 p.*,
 u.username, u.display_name, u.avatar_url, u.is_verified
 FROM posts p
 JOIN users u ON p.user_id = u.id
 JOIN post_hashtags ph ON p.id = ph.post_id
 JOIN hashtags h ON ph.hashtag_id = h.id
 WHERE h.tag = $1 AND p.is_deleted = FALSE AND u.is_banned = FALSE
 ORDER BY p.created_at DESC
 LIMIT $2 OFFSET $3`,
 [tag, limit, offset]
 );

 respond.ok(res, { tag, posts: result.rows });
}));

module.exports = router;
