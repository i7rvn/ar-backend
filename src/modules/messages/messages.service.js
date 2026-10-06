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

// ─── التحقق الموحد من عضوية المحادثة ───────────────────────────
async function assertConversationMember(conversationId, userId) {
 const member = await query(
  `SELECT 1
   FROM conversation_members
   WHERE conversation_id = $1 AND user_id = $2
   LIMIT 1`,
  [conversationId, userId]
 );
 if (!member.rows.length) {
  throw { status: 403, message: 'لست عضواً في هذه المحادثة', code: 'CONVERSATION_FORBIDDEN' };
 }
 return true;
}

// ─── إنشاء مجموعة ────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function createGroupConversation(creatorId, name, memberIds) {
 if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
 throw { status: 400, message: 'اسم المجموعة بين 1 و100 حرف' };
 }
 if (!Array.isArray(memberIds) || memberIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
 throw { status: 400, message: 'قائمة الأعضاء غير صالحة' };
 }

 // إزالة التكرار واستبعاد المنشئ نفسه قبل أي عدّ
 memberIds = [...new Set(memberIds)].filter((id) => id !== creatorId);
 if (memberIds.length < 2) throw { status: 400, message: 'المجموعة تحتاج عضوين على الأقل' };
 if (memberIds.length > 50) throw { status: 400, message: 'الحد الأقصى للمجموعة 50 عضو' };

 // ─── حماية المستخدمين من الزجّ بالمجموعات قسراً ────────────────
 // قبل هذا الفحص كان أي مستخدم يقدر يضيف أي شخص لمجموعة، حتى من حظره
 // أو من ضبط رسائله لـ"المتابَعين فقط" — وسيلة مضايقة مباشرة.
 // رسالة الخطأ عامة عمداً: ما نكشفش مين بالضبط حظر مين.
 const targets = await query(
 `SELECT u.id, u.who_can_message,
 EXISTS(SELECT 1 FROM user_blocks b
 WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
 OR (b.blocker_id = u.id AND b.blocked_id = $1)) AS blocked_either_way,
 EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id) AS creator_follows
 FROM users u
 WHERE u.id = ANY($2::uuid[]) AND u.is_banned = FALSE`,
 [creatorId, memberIds]
 );
 if (targets.rows.length !== memberIds.length) {
 throw { status: 400, message: 'بعض المستخدمين غير موجودين' };
 }
 const notAddable = targets.rows.some((u) =>
 u.blocked_either_way || (u.who_can_message === 'followers' && !u.creator_follows)
 );
 if (notAddable) {
 throw { status: 403, message: 'لا يمكن إضافة بعض المستخدمين لهذه المجموعة', code: 'MEMBER_NOT_ADDABLE' };
 }

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

async function getConversationEncryptionMembers(conversationId, userId) {
 const access = await query(
  `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
  [conversationId, userId]
 );
 if (!access.rows.length) {
  throw { status: 403, message: 'لست عضواً في هذه المحادثة', code: 'CONVERSATION_FORBIDDEN' };
 }
 const result = await query(
  `SELECT cm.user_id AS "userId",
          k.id AS "keyId",
          k.public_key_jwk AS "publicKeyJwk",
          k.key_version AS "keyVersion"
   FROM conversation_members cm
   LEFT JOIN user_e2e_keys k
     ON k.user_id = cm.user_id AND k.revoked_at IS NULL
   WHERE cm.conversation_id = $1
   ORDER BY cm.joined_at ASC`,
  [conversationId]
 );
 return result.rows;
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
 (SELECT COUNT(*) FROM message_deliveries WHERE message_id=m.id) AS delivered_count,
 COALESCE((
   SELECT jsonb_agg(jsonb_build_object(
     'messageId', e.message_id,
     'keyId', e.key_id,
     'encryptedMessageKey', e.encrypted_message_key
   ))
   FROM message_key_envelopes e
   WHERE e.message_id = m.id AND e.recipient_user_id = $2
 ), '[]'::jsonb) AS e2e_key_envelopes
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
async function sendMessage({ conversationId, senderId, encryptedContent, nonce, msgType = 'text', mediaUrl, replyToId, expiresIn, encryptionVersion = 2, encryptionAlgorithm = 'RSA-OAEP-256', keyEnvelopes = [] }) {
 const member = await query(
  `SELECT id FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
  [conversationId, senderId]
 );
 if (!member.rows.length) throw { status: 403, message: 'لست عضواً في هذه المحادثة' };

 if (![1, 2].includes(Number(encryptionVersion))) {
  throw { status: 400, message: 'نسخة التشفير غير مدعومة', code: 'UNSUPPORTED_ENCRYPTION_VERSION' };
 }
 if (Number(encryptionVersion) === 1 && process.env.ALLOW_LEGACY_MESSAGE_ENCRYPTION !== 'true') {
  throw { status: 426, message: 'يجب استخدام تشفير E2E الحديث لهذه الرسائل', code: 'E2E_REQUIRED' };
 }

 if (Number(encryptionVersion) === 2) {
  if (encryptionAlgorithm !== 'RSA-OAEP-256') {
   throw { status: 400, message: 'خوارزمية E2E غير مدعومة', code: 'UNSUPPORTED_E2E_ALGORITHM' };
  }
  if (!Array.isArray(keyEnvelopes)) {
   throw { status: 400, message: 'مفاتيح الرسالة غير صالحة', code: 'INVALID_E2E_ENVELOPES' };
  }

  const members = await query(
   `SELECT cm.user_id, k.id AS key_id
    FROM conversation_members cm
    LEFT JOIN user_e2e_keys k
      ON k.user_id = cm.user_id AND k.revoked_at IS NULL
    WHERE cm.conversation_id = $1`,
   [conversationId]
  );

  const envelopeByUser = new Map();
  for (const envelope of keyEnvelopes) {
   if (envelopeByUser.has(envelope.recipientUserId)) {
    throw { status: 400, message: 'يوجد envelope مكرر لنفس المستخدم', code: 'DUPLICATE_E2E_ENVELOPE' };
   }
   envelopeByUser.set(envelope.recipientUserId, envelope);
  }

  for (const row of members.rows) {
   const envelope = envelopeByUser.get(row.user_id);
   if (!row.key_id) {
    throw { status: 428, message: 'بعض أعضاء المحادثة لم يسجلوا مفتاح E2E بعد', code: 'E2E_KEYS_INCOMPLETE' };
   }
   if (!envelope || envelope.keyId !== row.key_id) {
    throw { status: 400, message: 'مفاتيح الرسالة لا تطابق مفاتيح أعضاء المحادثة', code: 'INVALID_E2E_ENVELOPES' };
   }
  }
  if (envelopeByUser.size !== members.rows.length) {
   throw { status: 400, message: 'لازم يكون للرسالة مفتاح مشفر لكل عضو في المحادثة', code: 'INVALID_E2E_ENVELOPES' };
  }
 }

 const expiresAt = expiresIn
  ? new Date(Date.now() + expiresIn * 1000)
  : null;
 const message = await withTransaction(async (client) => {
  const inserted = await client.query(
   `INSERT INTO messages
    (conversation_id, sender_id, encrypted_content, nonce, msg_type, media_url, reply_to_id, expires_at, encryption_version, encryption_algorithm)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
   [conversationId, senderId, encryptedContent, nonce, msgType, mediaUrl || null, replyToId || null, expiresAt, Number(encryptionVersion), Number(encryptionVersion) === 2 ? encryptionAlgorithm : 'legacy']
  );
  const created = inserted.rows[0];

  await client.query(
   `INSERT INTO message_reads (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
   [created.id, senderId]
  );

  if (Number(encryptionVersion) === 2) {
   for (const envelope of keyEnvelopes) {
    await client.query(
     `INSERT INTO message_key_envelopes (message_id, recipient_user_id, key_id, encrypted_message_key)
      VALUES ($1, $2, $3, $4)`,
     [created.id, envelope.recipientUserId, envelope.keyId, envelope.encryptedMessageKey]
    );
   }
  }

  return created;
 });

 const sender = await query(
  `SELECT username, display_name, avatar_url FROM users WHERE id = $1`,
  [senderId]
 );
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
 assertConversationMember,
 getOrCreateDirectConversation,
 createGroupConversation,
 getUserConversations,
 getConversationEncryptionMembers,
 getMessages,
 sendMessage,
 markMessagesRead,
 deleteMessage,
};
