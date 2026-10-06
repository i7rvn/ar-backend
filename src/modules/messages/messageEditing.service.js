const { query } = require('../../config/database');
const { publishEvent } = require('../websocket/publisher');

const EDIT_WINDOW_MS = 15 * 60 * 1000;

async function editMessage(messageId, userId, encryptedContent, nonce) {
  if (typeof encryptedContent !== 'string' || !encryptedContent.trim()) {
    throw { status: 400, message: 'محتوى الرسالة غير صالح', code: 'INVALID_MESSAGE_CONTENT' };
  }
  if (encryptedContent.length > 700000) {
    throw { status: 400, message: 'الرسالة كبيرة جداً', code: 'MESSAGE_TOO_LARGE' };
  }
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 128) {
    throw { status: 400, message: 'nonce غير صالح', code: 'INVALID_MESSAGE_NONCE' };
  }

  const current = await query(
    `SELECT id, sender_id, conversation_id, msg_type, created_at, is_deleted
     FROM messages
     WHERE id = $1`,
    [messageId]
  );
  if (!current.rows.length || current.rows[0].is_deleted) {
    throw { status: 404, message: 'الرسالة غير موجودة', code: 'MESSAGE_NOT_FOUND' };
  }

  const message = current.rows[0];
  if (message.sender_id !== userId) {
    throw { status: 403, message: 'لا يمكنك تعديل رسالة شخص آخر', code: 'MESSAGE_EDIT_FORBIDDEN' };
  }
  if (message.msg_type !== 'text') {
    throw { status: 400, message: 'يمكن تعديل الرسائل النصية فقط', code: 'MESSAGE_EDIT_UNSUPPORTED' };
  }

  const age = Date.now() - new Date(message.created_at).getTime();
  if (age > EDIT_WINDOW_MS) {
    throw { status: 400, message: 'انتهت مهلة تعديل الرسالة', code: 'MESSAGE_EDIT_WINDOW_EXPIRED' };
  }

  const updated = await query(
    `UPDATE messages
     SET encrypted_content = $1, nonce = $2, is_edited = TRUE, edited_at = NOW(), updated_at = NOW()
     WHERE id = $3 AND sender_id = $4
     RETURNING *`,
    [encryptedContent, nonce, messageId, userId]
  );

  await publishEvent('ws:event', {
    type: 'message:edited',
    roomId: message.conversation_id,
    payload: updated.rows[0],
  });

  return updated.rows[0];
}

module.exports = { EDIT_WINDOW_MS, editMessage };
