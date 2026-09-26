// ═══════════════════════════════════════════════════════════════
// AR App — WebSocket Event Publisher
// ينشر أحداثاً عبر قناة Redis يشترك بها خادم WebSocket المدمج
// (src/modules/websocket/server.js) ليعيد بثّها للعملاء المتصلين
// ═══════════════════════════════════════════════════════════════

const { client: redisClient } = require('../../config/redis');
const logger = require('../../config/logger');

// ─── نشر حدث عبر Redis Go يلتقطه ──────────────────────────
async function publishEvent(channel, payload) {
 try {
 await redisClient.publish(channel, JSON.stringify(payload));
 } catch (err) {
 logger.error('فشل نشر الحدث:', err);
 }
}

// ─── إشعار رسالة جديدة ────────────────────────────────────────
async function notifyNewMessage(conversationId, message, senderInfo) {
 await publishEvent('ws:event', {
 type: 'message:new',
 roomId: conversationId,
 payload: {
 ...message,
 sender: senderInfo,
 },
 });
}

// ─── إشعار عام لمستخدم معين ───────────────────────────────────
async function notifyUser(userId, type, payload) {
 await publishEvent('ws:event', {
 type,
 userId,
 payload,
 });
}

// ─── إشعار منشور جديد لمتابعي شخص ────────────────────────────
async function notifyFollowers(followerIds, post) {
 for (const followerId of followerIds) {
 await publishEvent('ws:event', {
 type: 'post:new',
 userId: followerId,
 payload: post,
 });
 }
}

module.exports = { publishEvent, notifyNewMessage, notifyUser, notifyFollowers };
