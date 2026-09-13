// ═══════════════════════════════════════════════════════════════
// AR App — Messages Service (رسائل E2E مشفرة)
// ═══════════════════════════════════════════════════════════════

const { query, withTransaction } = require('../../config/database');
const { respond } = require('../../utils/helpers');

// ─── إنشاء أو جلب محادثة بين شخصين ──────────────────────────
async function getOrCreateDirectConversation(userId1, userId2) {
 // تحقق إذا محادثة موجودة
 const existing = await query(
 `SELECT c.id FROM conversations c
 JOIN conversation_members cm1 ON c.id = cm1.conversation_id AND cm1.user_id = $1
 JOIN conversation_members cm2 ON c.id = cm2.conversation_id AND cm2.user_id = $2
 WHERE c.type = 'direct'
 LIMIT 1`,
 [userId1, userId2]
 );

 if (existing.rows.length) return existing.rows[0].id;

 // إنشاء محادثة جديدة
 return await withTransaction(async (client) => {
 const conv = await client.query(
 `INSERT INTO conversations (type, created_by) VALUES ('direct', $1) RETURNING id`,
 [userId1]
 );
 const convId = conv.rows[0].id;

 await client.query(
 `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
 [convId, userId1, userId2]
 );

 return convId;
 });
}

// ─── إنشاء مجموعة ────────────────────────────────────────────
async function createGroupConversation(creatorId, name, memberIds) {
 if (memberIds.length < 2) throw { status: 400, message: 'المجموعة تحتاج عضوين على الأقل' };
 if (memberIds.length > 50) throw { status: 400, message: 'الحد الأقصى للمجموعة 50 عضو' };

 return await withTransaction(async (client) => {
 const conv = await client.query(
 `INSERT INTO conversations (type, name, created_by) VALUES ('group', $1, $2) RETURNING id`,
 [name, creatorId]
 );
 const convId = conv.rows[0].id;

 // إضافة المنشئ كـ admin
 await client.query(
 `INSERT INTO conversation_members (conversation_id, user_id, role) VALUES ($1,$2,'admin')`,
 [convId, creatorId]
 );

 // إضافة الأعضاء
 for (const memberId of memberIds) {
 await client.query(
 `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
 [convId, memberId]
 );
 }

 return convId;
 });
}

// ─── جلب محادثات المستخدم ────────────────────────────────────
async function getUserConversations(userId, page = 1, limit = 20) {
 const offset = (page - 1) * limit;

 const result = await query(
 `SELECT
 c.id, c.type, c.name, c.avatar_url,
 c.last_msg_at, c.last_msg_text,
 cm.unread_count, cm.is_muted,
 -- بيانات الطرف الآخر (للمحادثات المباشرة)
 CASE WHEN c.type = 'direct' THEN
 (SELECT u.display_name FROM users u
 JOIN conversation_members cm2 ON cm2.user_id = u.id
 WHERE cm2.conversation_id = c.id AND cm2.user_id != $1
 LIMIT 1)
 ELSE c.name END AS display_name,
 CASE WHEN c.type = 'direct' THEN
 (SELECT u.avatar_url FROM users u
 JOIN conversation_members cm2 ON cm2.user_id = u.id
 WHERE cm2.conversation_id = c.id AND cm2.user_id != $1
 LIMIT 1)
 ELSE c.avatar_url END AS display_avatar,
 CASE WHEN c.type = 'direct' THEN
 (SELECT u.id FROM users u
 JOIN conversation_members cm2 ON cm2.user_id = u.id
 WHERE cm2.conversation_id = c.id AND cm2.user_id != $1
 LIMIT 1)
 ELSE NULL END AS other_user_id
 FROM conversations c
 JOIN conversation_members cm ON c.id = cm.conversation_id AND cm.user_id = $1
 ORDER BY c.last_msg_at DESC NULLS LAST
 LIMIT $2 OFFSET $3`,
 [userId, limit, offset]
 );

 return result.rows;
}

// ─── جلب رسائل محادثة ────────────────────────────────────────
async function getMessages(conversationId, userId, page = 1, limit = 30) {
 // تحقق أن المستخدم عضو في المحادثة
 const member = await query(
 `SELECT id FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
 [conversationId, userId]
 );
 if (!member.rows.length) throw { status: 403, message: 'لست عضواً في هذه المحادثة' };

 const offset = (page - 1) * limit;

 const result = await query(
 `SELECT
 m.*,
 u.username, u.display_name, u.avatar_url,
 EXISTS(SELECT 1 FROM message_reads WHERE message_id=m.id AND user_id=$2) AS read_by_me,
 (SELECT COUNT(*) FROM message_reads WHERE message_id=m.id) AS read_count,
 (SELECT COUNT(*) FROM message_deliveries WHERE message_id=m.id) AS delivered_count
 FROM messages m
 JOIN users u ON m.sender_id = u.id
 WHERE m.conversation_id = $1 AND m.is_deleted = FALSE
 ORDER BY m.created_at DESC
 LIMIT $3 OFFSET $4`,
 [conversationId, userId, limit, offset]
 );

 // وضع الرسائل كـ "مقروء"تلقائياً
 await markMessagesRead(conversationId, userId);

 return result.rows.reverse(); // ترتيب من القديم للحديث
}

// ─── إرسال رسالة ─────────────────────────────────────────────
async function sendMessage({ conversationId, senderId, encryptedContent, nonce, msgType = 'text', mediaUrl, replyToId, expiresIn }) {
 // تحقق العضوية
 const member = await query(
 `SELECT id FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
 [conversationId, senderId]
 );
 if (!member.rows.length) throw { status: 403, message: 'لست عضواً في هذه المحادثة' };

 const expiresAt = expiresIn
 ? new Date(Date.now() + expiresIn * 1000)
 : null;

 const result = await query(
 `INSERT INTO messages
 (conversation_id, sender_id, encrypted_content, nonce, msg_type, media_url, reply_to_id, expires_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
 RETURNING *`,
 [conversationId, senderId, encryptedContent, nonce, msgType, mediaUrl || null, replyToId || null, expiresAt]
 );

 const message = result.rows[0];

 // وضع الرسالة كـ "مقروء"للمرسل نفسه
 await query(
 `INSERT INTO message_reads (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
 [message.id, senderId]
 );

 // تحديث معاينة آخر رسالة ووقتها - تستخدمهما قائمة المحادثات للترتيب والعرض
 const previewText = msgType === 'text' ? encryptedContent.slice(0, 100) : `[${msgType}]`;
 await query(
 `UPDATE conversations SET last_msg_at = NOW(), last_msg_text = $1 WHERE id = $2`,
 [previewText, conversationId]
 );

 // زيادة عداد غير المقروء لباقي أعضاء المحادثة
 await query(
 `UPDATE conversation_members SET unread_count = unread_count + 1
 WHERE conversation_id = $1 AND user_id != $2`,
 [conversationId, senderId]
 );

 // بث الرسالة فورياً لباقي أعضاء المحادثة المتصلين
 const sender = await query(`SELECT username, display_name, avatar_url FROM users WHERE id = $1`, [senderId]);
 const { notifyNewMessage } = require('../websocket/publisher');
 notifyNewMessage(conversationId, message, sender.rows[0]).catch(() => {});

 return message;
}

// ─── وضع رسائل كـ "مقروء" ────────────────────────────────────
async function markMessagesRead(conversationId, userId) {
 await withTransaction(async (client) => {
 // جلب الرسائل غير المقروءة
 const unread = await client.query(
 `SELECT m.id FROM messages m
 WHERE m.conversation_id = $1
 AND m.sender_id != $2
 AND NOT EXISTS (SELECT 1 FROM message_reads WHERE message_id=m.id AND user_id=$2)`,
 [conversationId, userId]
 );

 if (!unread.rows.length) return;

 // إدخال جماعي بمعاملات حقيقية (بلا تضمين القيم بالنص مباشرة)
 const values = [];
 const placeholders = unread.rows.map((r, i) => {
 values.push(r.id, userId);
 return `($${i * 2 + 1}, $${i * 2 + 2})`;
 }).join(',');
 await client.query(
 `INSERT INTO message_reads (message_id, user_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
 values
 );

 // تصفير عداد غير المقروء
 await client.query(
 `UPDATE conversation_members SET unread_count=0, last_read_at=NOW()
 WHERE conversation_id=$1 AND user_id=$2`,
 [conversationId, userId]
 );
 });
}

// ─── حذف رسالة ───────────────────────────────────────────────
async function deleteMessage(messageId, userId) {
 const msg = await query(
 `SELECT sender_id, conversation_id FROM messages WHERE id=$1`, [messageId]
 );
 if (!msg.rows.length) throw { status: 404, message: 'الرسالة غير موجودة' };
 if (msg.rows[0].sender_id !== userId) throw { status: 403, message: 'لا يمكنك حذف رسالة شخص آخر' };

 await query(
 `UPDATE messages SET is_deleted=TRUE, encrypted_content='[رسالة محذوفة]' WHERE id=$1`,
 [messageId]
 );

 return msg.rows[0].conversation_id;
}

module.exports = {
 getOrCreateDirectConversation,
 createGroupConversation,
 getUserConversations,
 getMessages,
 sendMessage,
 markMessagesRead,
 deleteMessage,
};
