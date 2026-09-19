const express = require('express');
const { query } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { respond, asyncHandler } = require('../../utils/helpers');

const router = express.Router();

// ─── متابعة / إلغاء متابعة ────────────────────────────────────
router.post('/:userId', authenticate, asyncHandler(async (req, res) => {
 const followingId = req.params.userId;
 const followerId = req.user.id;

 if (followerId === followingId) {
 return respond.error(res, 'لا يمكنك متابعة نفسك', 400);
 }

 // تحقق من وجود المستخدم
 const user = await query('SELECT id FROM users WHERE id=$1 AND is_banned=FALSE', [followingId]);
 if (!user.rows.length) return respond.notFound(res, 'المستخدم غير موجود');

 const blocked = await query(
 `SELECT id FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
 [followerId, followingId]
 );
 if (blocked.rows.length) {
 return respond.error(res, 'لا يمكن إتمام هذا الإجراء', 403, 'USER_BLOCKED');
 }

 const existing = await query(
 'SELECT id FROM follows WHERE follower_id=$1 AND following_id=$2',
 [followerId, followingId]
 );

 if (existing.rows.length) {
 // إلغاء المتابعة
 await query(
 'DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',
 [followerId, followingId]
 );
 return respond.ok(res, { following: false }, 'تم إلغاء المتابعة');
 } else {
 // متابعة
 await query(
 'INSERT INTO follows (follower_id, following_id) VALUES ($1,$2)',
 [followerId, followingId]
 );
 const { createNotification } = require('../notifications/notifications.service');
 createNotification({ userId: followingId, actorId: followerId, type: 'follow' }).catch(() => {});
 const { awardReputation } = require('../users/reputation.service');
 awardReputation(followingId, 'follow').catch(() => {});
 return respond.ok(res, { following: true }, 'تمت المتابعة');
 }
}));

// ─── قائمة المتابِعين ──────────────────────────────────────────
router.get('/:userId/followers', asyncHandler(async (req, res) => {
 const limit = parseInt(req.query.limit) || 20;
 const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

 const result = await query(
 `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
 FROM follows f
 JOIN users u ON f.follower_id = u.id
 WHERE f.following_id = $1 AND u.is_banned = FALSE
 ORDER BY f.created_at DESC
 LIMIT $2 OFFSET $3`,
 [req.params.userId, limit, offset]
 );
 respond.ok(res, result.rows);
}));

// ─── قائمة المتابَعين ──────────────────────────────────────────
router.get('/:userId/following', asyncHandler(async (req, res) => {
 const limit = parseInt(req.query.limit) || 20;
 const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

 const result = await query(
 `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
 FROM follows f
 JOIN users u ON f.following_id = u.id
 WHERE f.follower_id = $1 AND u.is_banned = FALSE
 ORDER BY f.created_at DESC
 LIMIT $2 OFFSET $3`,
 [req.params.userId, limit, offset]
 );
 respond.ok(res, result.rows);
}));

// ─── اقتراح أشخاص للمتابعة ────────────────────────────────────
router.get('/suggestions', authenticate, asyncHandler(async (req, res) => {
 const result = await query(
 `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified,
 u.followers_count
 FROM users u
 WHERE u.id != $1
 AND u.is_banned = FALSE
 AND NOT EXISTS (
 SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=u.id
 )
 ORDER BY u.followers_count DESC, u.created_at DESC
 LIMIT 5`,
 [req.user.id]
 );
 respond.ok(res, result.rows);
}));

module.exports = router;
