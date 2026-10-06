const express = require('express');
const messagesService = require('./messages.service');
const { authenticate } = require('../../middleware/auth');
const { respond, asyncHandler } = require('../../utils/helpers');
const { query } = require('../../config/database');
const { z } = require('zod');
const reactionsService = require('./messageReactions.service');
const { editMessage } = require('./messageEditing.service');
const { pinMessage, unpinMessage, listPinnedMessages } = require('./messagePinning.service');

const router = express.Router();

const sendMessageSchema = z.object({
 conversationId: z.string().uuid(),
 encryptedContent: z.string().min(1).max(700000),
 nonce: z.string().min(8).max(128),
 msgType: z.enum(['text', 'image', 'video', 'audio', 'file']).optional(),
 mediaUrl: z.string().url().max(500).optional(),
 replyToId: z.string().uuid().optional(),
 expiresIn: z.coerce.number().int().min(0).max(30 * 24 * 60 * 60).optional(),
}).strict();

const editMessageSchema = z.object({
 encryptedContent: z.string().min(1).max(700000),
 nonce: z.string().min(8).max(128),
}).strict();

const reactionSchema = z.object({
 reaction: z.enum(['👍', '❤️', '😂', '😢', '😡', '😮', '👎']),
}).strict();



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
 const parsed = sendMessageSchema.safeParse(req.body);
 if (!parsed.success) {
  return respond.error(res, 'بيانات الرسالة غير صالحة', 400, 'INVALID_MESSAGE_PAYLOAD');
 }
 const { conversationId, encryptedContent, nonce, msgType, mediaUrl, replyToId, expiresIn } = parsed.data;

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

router.patch('/:id', asyncHandler(async (req, res) => {
 const parsed = editMessageSchema.safeParse(req.body);
 if (!parsed.success) return respond.error(res, 'بيانات تعديل الرسالة غير صالحة', 400, 'INVALID_MESSAGE_EDIT');
 const message = await editMessage(req.params.id, req.user.id, parsed.data.encryptedContent, parsed.data.nonce);
 respond.ok(res, message, 'تم تعديل الرسالة');
}));

router.get('/conversations/:id/pinned', asyncHandler(async (req, res) => {
 const messages = await listPinnedMessages(req.params.id, req.user.id);
 respond.ok(res, messages);
}));

router.post('/:id/pin', asyncHandler(async (req, res) => {
 const message = await pinMessage(req.params.id, req.user.id);
 respond.ok(res, message, 'تم تثبيت الرسالة');
}));

router.delete('/:id/pin', asyncHandler(async (req, res) => {
 const message = await unpinMessage(req.params.id, req.user.id);
 respond.ok(res, message, 'تم إلغاء تثبيت الرسالة');
}));

// ─── تفاعلات الرسائل ──────────────────────────────────────────
router.get('/:id/reactions', asyncHandler(async (req, res) => {
 const reactions = await reactionsService.getMessageReactions(req.params.id, req.user.id);
 respond.ok(res, reactions);
}));

router.post('/:id/reaction', asyncHandler(async (req, res) => {
 const parsed = reactionSchema.safeParse(req.body);
 if (!parsed.success) return respond.error(res, 'التفاعل غير صالح', 400, 'INVALID_MESSAGE_REACTION');
 const reactions = await reactionsService.addMessageReaction(req.params.id, req.user.id, parsed.data.reaction);
 respond.ok(res, reactions, 'تمت إضافة التفاعل');
}));

router.delete('/:id/reaction/:reaction', asyncHandler(async (req, res) => {
 const reactions = await reactionsService.removeMessageReaction(req.params.id, req.user.id, req.params.reaction);
 respond.ok(res, reactions, 'تم حذف التفاعل');
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
