const express = require('express');
const messagesService = require('./messages.service');
const { authenticate } = require('../../middleware/auth');
const { respond, asyncHandler } = require('../../utils/helpers');
const { query } = require('../../config/database');

const router = express.Router();

// كل مسارات الرسائل محمية
router.use(authenticate);

// ─── قائمة المحادثات ──────────────────────────────────────────
router.get('/conversations', asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 20;
 const convs = await messagesService.getUserConversations(req.user.id, page, limit);
 respond.ok(res, convs);
}));

// ─── بدء محادثة مباشرة ────────────────────────────────────────
router.post('/conversations/direct', asyncHandler(async (req, res) => {
 const { userId } = req.body;
 if (!userId) return respond.error(res, 'userId مطلوب', 400);
 if (userId === req.user.id) return respond.error(res, 'لا يمكنك مراسلة نفسك', 400);

 const blocked = await query(
 `SELECT id FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
 [req.user.id, userId]
 );
 if (blocked.rows.length) {
 return respond.error(res, 'لا يمكن إتمام هذا الإجراء', 403, 'USER_BLOCKED');
 }

 const recipient = await query(`SELECT who_can_message FROM users WHERE id = $1`, [userId]);
 if (!recipient.rows.length) return respond.notFound(res, 'المستخدم غير موجود');

 if (recipient.rows[0].who_can_message === 'followers') {
 const isFollower = await query(
 `SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2`,
 [req.user.id, userId]
 );
 if (!isFollower.rows.length) {
 return respond.error(res, 'هذا المستخدم يقبل رسائل من متابَعيه فقط', 403, 'MESSAGE_RESTRICTED');
 }
 }

 const convId = await messagesService.getOrCreateDirectConversation(req.user.id, userId);
 respond.ok(res, { conversationId: convId });
}));

// ─── إنشاء مجموعة ────────────────────────────────────────────
router.post('/conversations/group', asyncHandler(async (req, res) => {
 const { name, memberIds } = req.body;
 if (!name) return respond.error(res, 'اسم المجموعة مطلوب', 400);
 if (!memberIds?.length) return respond.error(res, 'أضف أعضاء للمجموعة', 400);

 const convId = await messagesService.createGroupConversation(req.user.id, name, memberIds);
 respond.created(res, { conversationId: convId }, 'تم إنشاء المجموعة');
}));

// ─── رسائل محادثة ────────────────────────────────────────────
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 30;
 const msgs = await messagesService.getMessages(req.params.id, req.user.id, page, limit);
 respond.ok(res, msgs);
}));

// ─── إرسال رسالة ─────────────────────────────────────────────
router.post('/send', asyncHandler(async (req, res) => {
 const { conversationId, encryptedContent, nonce, msgType, mediaUrl, replyToId, expiresIn } = req.body;

 if (!conversationId || !encryptedContent || !nonce) {
 return respond.error(res, 'conversationId و encryptedContent و nonce مطلوبة', 400);
 }

 const msg = await messagesService.sendMessage({
 conversationId,
 senderId: req.user.id,
 encryptedContent,
 nonce,
 msgType,
 mediaUrl,
 replyToId,
 expiresIn,
 });

 respond.created(res, msg, 'تم إرسال الرسالة');
}));

// ─── حذف رسالة ───────────────────────────────────────────────
router.delete('/:id', asyncHandler(async (req, res) => {
 await messagesService.deleteMessage(req.params.id, req.user.id);
 respond.ok(res, {}, 'تم حذف الرسالة');
}));

// ─── وضع محادثة كـ "مقروء" ────────────────────────────────────
router.put('/conversations/:id/read', asyncHandler(async (req, res) => {
 await messagesService.markMessagesRead(req.params.id, req.user.id);
 respond.ok(res, {}, 'تم');
}));

module.exports = router;
