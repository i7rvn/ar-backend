const { query, withTransaction } = require('../../config/database');
const { publishEvent } = require('../websocket/publisher');

const EDIT_WINDOW_MS = 15 * 60 * 1000;

async function editMessage(messageId, userId, encryptedContent, nonce, keyEnvelopes = undefined) {
  if (typeof encryptedContent !== 'string' || !encryptedContent.trim()) throw { status: 400, message: 'محتوى الرسالة غير صالح', code: 'INVALID_MESSAGE_CONTENT' };
  if (encryptedContent.length > 700000) throw { status: 400, message: 'الرسالة كبيرة جداً', code: 'MESSAGE_TOO_LARGE' };
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) throw { status: 400, message: 'nonce غير صالح', code: 'INVALID_MESSAGE_NONCE' };

  const current = await query(
    `SELECT id, sender_id, conversation_id, msg_type, created_at, is_deleted, encryption_version, encryption_algorithm
     FROM messages WHERE id = $1`,
    [messageId]
  );
  if (!current.rows.length || current.rows[0].is_deleted) throw { status: 404, message: 'الرسالة غير موجودة', code: 'MESSAGE_NOT_FOUND' };
  const message = current.rows[0];
  if (message.sender_id !== userId) throw { status: 403, message: 'لا يمكنك تعديل رسالة شخص آخر', code: 'MESSAGE_EDIT_FORBIDDEN' };
  if (message.msg_type !== 'text') throw { status: 400, message: 'يمكن تعديل الرسائل النصية فقط', code: 'MESSAGE_EDIT_UNSUPPORTED' };
  if (Date.now() - new Date(message.created_at).getTime() > EDIT_WINDOW_MS) throw { status: 400, message: 'انتهت مهلة تعديل الرسالة', code: 'MESSAGE_EDIT_WINDOW_EXPIRED' };

  const updated = await withTransaction(async (client) => {
    if (Number(message.encryption_version) >= 2) {
      if (!Array.isArray(keyEnvelopes) || !keyEnvelopes.length) throw { status: 400, message: 'رسالة E2E تحتاج مفاتيح المستلمين عند التعديل', code: 'E2E_ENVELOPES_REQUIRED' };
      const members = await client.query(
        `SELECT cm.user_id, k.id AS key_id
         FROM conversation_members cm
         LEFT JOIN user_e2e_keys k ON k.user_id = cm.user_id AND k.revoked_at IS NULL
         WHERE cm.conversation_id = $1`,
        [message.conversation_id]
      );
      const byUser = new Map();
      for (const envelope of keyEnvelopes) {
        if (byUser.has(envelope.recipientUserId)) throw { status: 400, message: 'يوجد envelope مكرر', code: 'DUPLICATE_E2E_ENVELOPE' };
        byUser.set(envelope.recipientUserId, envelope);
      }
      for (const member of members.rows) {
        const envelope = byUser.get(member.user_id);
        if (!member.key_id || !envelope || envelope.keyId !== member.key_id) throw { status: 400, message: 'مفاتيح التعديل لا تطابق أعضاء المحادثة', code: 'INVALID_E2E_ENVELOPES' };
      }
      if (byUser.size !== members.rows.length) throw { status: 400, message: 'لازم envelope لكل عضو', code: 'INVALID_E2E_ENVELOPES' };
    }

    const updatedResult = await client.query(
      `UPDATE messages
       SET encrypted_content = $1, nonce = $2, is_edited = TRUE, edited_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND sender_id = $4
       RETURNING *`,
      [encryptedContent, nonce, messageId, userId]
    );
    if (Number(message.encryption_version) >= 2) {
      await client.query('DELETE FROM message_key_envelopes WHERE message_id = $1', [messageId]);
      for (const envelope of keyEnvelopes) {
        await client.query(
          `INSERT INTO message_key_envelopes (message_id, recipient_user_id, key_id, encrypted_message_key)
           VALUES ($1, $2, $3, $4)`,
          [messageId, envelope.recipientUserId, envelope.keyId, envelope.encryptedMessageKey]
        );
      }
    }
    return updatedResult.rows[0];
  });

  await publishEvent('ws:event', { type: 'message:edited', roomId: message.conversation_id, payload: updated });
  return updated;
}

module.exports = { EDIT_WINDOW_MS, editMessage };