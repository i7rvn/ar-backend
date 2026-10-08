const express = require('express');
const { query, withTransaction } = require('../../config/database');
const { authenticate } = require('../../middleware/auth');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const { respond, asyncHandler } = require('../../utils/helpers');
const { canViewConnectionLists, resolveFollowAction } = require('./followAccess');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pagination(queryParams) {
 const parsedLimit = Number.parseInt(queryParams.limit, 10);
 const parsedPage = Number.parseInt(queryParams.page, 10);
 const limit = Math.min(Math.max(parsedLimit || 20, 1), 100);
 const page = Math.min(Math.max(parsedPage || 1, 1), 1000000);
 return { limit, offset: (page - 1) * limit };
}

async function canReadConnectionList(req, res, targetId) {
 if (!UUID_PATTERN.test(targetId)) {
  respond.notFound(res, 'المستخدم غير موجود');
  return false;
 }

 const target = await query(
  'SELECT id, is_private FROM users WHERE id = $1 AND is_banned = FALSE',
  [targetId]
 );
 if (!target.rows.length) {
  respond.notFound(res, 'المستخدم غير موجود');
  return false;
 }

 let isFollowing = false;
 if (req.user && req.user.id !== targetId) {
  const follow = await query(
   'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
   [req.user.id, targetId]
  );
  isFollowing = follow.rows.length > 0;
 }

 if (!canViewConnectionLists({
  isPrivate: target.rows[0].is_private,
  viewerId: req.user?.id,
  targetId,
  isFollowing,
 })) {
  respond.error(res, 'قوائم هذا الحساب خاصة', 403, 'PRIVATE_PROFILE');
  return false;
 }

 return true;
}

router.get('/requests', authenticate, asyncHandler(async (req, res) => {
 const result = await query(
  `SELECT fr.follower_id AS id, fr.created_at, u.username, u.display_name, u.avatar_url, u.is_verified
   FROM follow_requests fr
   JOIN users u ON u.id = fr.follower_id
   WHERE fr.following_id = $1 AND u.is_banned = FALSE
   ORDER BY fr.created_at DESC
   LIMIT 100`,
  [req.user.id]
 );
 respond.ok(res, result.rows);
}));

router.post('/requests/:followerId/accept', authenticate, asyncHandler(async (req, res) => {
 const followerId = req.params.followerId;
 if (!UUID_PATTERN.test(followerId)) return respond.notFound(res, 'الطلب غير موجود');

 const accepted = await withTransaction(async (client) => {
  const lockedUserIds = [req.user.id, followerId].sort();
  await client.query(
   'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
   [lockedUserIds]
  );
  const request = await client.query(
   `SELECT fr.follower_id
    FROM follow_requests fr
    JOIN users follower ON follower.id = fr.follower_id AND follower.is_banned = FALSE
    WHERE fr.follower_id = $1 AND fr.following_id = $2
    FOR UPDATE OF fr`,
   [followerId, req.user.id]
  );
  if (!request.rows.length) return false;

  const blocked = await client.query(
   `SELECT 1 FROM user_blocks
    WHERE (blocker_id = $1 AND blocked_id = $2)
       OR (blocker_id = $2 AND blocked_id = $1)`,
   [req.user.id, followerId]
  );
  if (blocked.rows.length) {
   await client.query(
    'DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2',
    [followerId, req.user.id]
   );
   return false;
  }

  await client.query(
   'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
   [followerId, req.user.id]
  );
  await client.query(
   'DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2',
   [followerId, req.user.id]
  );
  return true;
 });

 if (!accepted) return respond.notFound(res, 'الطلب غير موجود أو تعذر قبوله');
 const { createNotification } = require('../notifications/notifications.service');
 createNotification({ userId: followerId, actorId: req.user.id, type: 'follow' }).catch(() => {});
 const { awardReputation } = require('../users/reputation.service');
 awardReputation(req.user.id, 'follow').catch(() => {});
 respond.ok(res, { accepted: true, followerId }, 'تم قبول طلب المتابعة');
}));

router.post('/requests/:followerId/reject', authenticate, asyncHandler(async (req, res) => {
 const followerId = req.params.followerId;
 if (!UUID_PATTERN.test(followerId)) return respond.notFound(res, 'الطلب غير موجود');
 const result = await query(
  'DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2 RETURNING follower_id',
  [followerId, req.user.id]
 );
 if (!result.rows.length) return respond.notFound(res, 'الطلب غير موجود');
 respond.ok(res, { rejected: true, followerId }, 'تم رفض طلب المتابعة');
}));

router.post('/:userId', authenticate, asyncHandler(async (req, res) => {
 const followingId = req.params.userId;
 const followerId = req.user.id;

 if (!UUID_PATTERN.test(followingId)) return respond.notFound(res, 'المستخدم غير موجود');
 if (followerId === followingId) {
  return respond.error(res, 'لا يمكنك متابعة نفسك', 400);
 }

 const outcome = await withTransaction(async (client) => {
  const user = await client.query(
   'SELECT id, is_private FROM users WHERE id = $1 AND is_banned = FALSE FOR UPDATE',
   [followingId]
  );
  if (!user.rows.length) return { kind: 'not_found' };

  const blocked = await client.query(
   `SELECT 1 FROM user_blocks
    WHERE (blocker_id = $1 AND blocked_id = $2)
       OR (blocker_id = $2 AND blocked_id = $1)`,
   [followerId, followingId]
  );
  if (blocked.rows.length) return { kind: 'blocked' };

  const existing = await client.query(
   'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
   [followerId, followingId]
  );
  const pending = await client.query(
   'SELECT 1 FROM follow_requests WHERE follower_id = $1 AND following_id = $2',
   [followerId, followingId]
  );
  const action = resolveFollowAction({
   isPrivate: user.rows[0].is_private,
   isFollowing: existing.rows.length > 0,
   isRequested: pending.rows.length > 0,
  });

  if (action === 'unfollow') {
   await client.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
   await client.query('DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
   return { kind: 'unfollowed' };
  }

  if (action === 'cancel_request') {
   await client.query('DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
   return { kind: 'request_cancelled' };
  }

  if (action === 'request') {
   const inserted = await client.query(
    'INSERT INTO follow_requests (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING follower_id',
    [followerId, followingId]
   );
   return { kind: 'requested', created: inserted.rows.length > 0 };
  }

  await client.query('DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2', [followerId, followingId]);
  await client.query(
   'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
   [followerId, followingId]
  );
  return { kind: 'followed' };
 });

 if (outcome.kind === 'not_found') return respond.notFound(res, 'المستخدم غير موجود');
 if (outcome.kind === 'blocked') return respond.error(res, 'لا يمكن إتمام هذا الإجراء', 403, 'USER_BLOCKED');
 if (outcome.kind === 'unfollowed') return respond.ok(res, { following: false, requested: false }, 'تم إلغاء المتابعة');
 if (outcome.kind === 'request_cancelled') return respond.ok(res, { following: false, requested: false }, 'تم إلغاء طلب المتابعة');
 if (outcome.kind === 'requested') {
  if (outcome.created) {
   const { createNotification } = require('../notifications/notifications.service');
   createNotification({ userId: followingId, actorId: followerId, type: 'follow_request' }).catch(() => {});
  }
  return respond.ok(res, { following: false, requested: true }, 'أُرسل طلب المتابعة');
 }

 const { createNotification } = require('../notifications/notifications.service');
 createNotification({ userId: followingId, actorId: followerId, type: 'follow' }).catch(() => {});
 const { awardReputation } = require('../users/reputation.service');
 awardReputation(followingId, 'follow').catch(() => {});
 respond.ok(res, { following: true, requested: false }, 'تمت المتابعة');
}));

router.get('/:userId/followers', optionalAuthenticate, asyncHandler(async (req, res) => {
 const { limit, offset } = pagination(req.query);
 const targetId = req.params.userId;
 if (!(await canReadConnectionList(req, res, targetId))) return;

 const result = await query(
  `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
   FROM follows f
   JOIN users u ON f.follower_id = u.id
   WHERE f.following_id = $1 AND u.is_banned = FALSE
   ORDER BY f.created_at DESC
   LIMIT $2 OFFSET $3`,
  [targetId, limit, offset]
 );
 respond.ok(res, result.rows);
}));

router.get('/:userId/following', optionalAuthenticate, asyncHandler(async (req, res) => {
 const { limit, offset } = pagination(req.query);
 const targetId = req.params.userId;
 if (!(await canReadConnectionList(req, res, targetId))) return;

 const result = await query(
  `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified
   FROM follows f
   JOIN users u ON f.following_id = u.id
   WHERE f.follower_id = $1 AND u.is_banned = FALSE
   ORDER BY f.created_at DESC
   LIMIT $2 OFFSET $3`,
  [targetId, limit, offset]
 );
 respond.ok(res, result.rows);
}));

router.get('/suggestions', authenticate, asyncHandler(async (req, res) => {
 const result = await query(
  `SELECT u.id, u.username, u.display_name, u.avatar_url, u.is_verified,
          u.followers_count
   FROM users u
   WHERE u.id != $1
     AND u.is_banned = FALSE
     AND NOT EXISTS (
       SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM follow_requests WHERE follower_id = $1 AND following_id = u.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
       WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
          OR (b.blocker_id = u.id AND b.blocked_id = $1)
     )
   ORDER BY u.followers_count DESC, u.created_at DESC
   LIMIT 5`,
  [req.user.id]
 );
 respond.ok(res, result.rows);
}));

module.exports = router;

