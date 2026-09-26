const express = require('express');
const { query } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { respond, asyncHandler } = require('../../utils/helpers');

const router = express.Router();

// ─── جلب الإشعارات ────────────────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
 const limit = parseInt(req.query.limit) || 20;
 const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

 const result = await query(
 `SELECT
 n.*,
 u.username AS actor_username,
 u.display_name AS actor_display_name,
 u.avatar_url AS actor_avatar,
 p.content AS post_content
 FROM notifications n
 JOIN users u ON n.actor_id = u.id
 LEFT JOIN posts p ON n.post_id = p.id
 WHERE n.user_id = $1
 ORDER BY n.created_at DESC
 LIMIT $2 OFFSET $3`,
 [req.user.id, limit, offset]
 );

 // عدد غير المقروءة
 const unread = await query(
 'SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE',
 [req.user.id]
 );

 respond.ok(res, {
 notifications: result.rows,
 unread_count: parseInt(unread.rows[0].count),
 });
}));

// ─── وضع كل الإشعارات كـ "مقروء" ─────────────────────────────
router.put('/read-all', authenticate, asyncHandler(async (req, res) => {
 await query(
 'UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE',
 [req.user.id]
 );
 respond.ok(res, {}, 'تم وضع كل الإشعارات كـ مقروء');
}));

// ─── وضع إشعار واحد كـ "مقروء" ───────────────────────────────
router.put('/:id/read', authenticate, asyncHandler(async (req, res) => {
 await query(
 'UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2',
 [req.params.id, req.user.id]
 );
 respond.ok(res, {}, 'تم');
}));

module.exports = router;
