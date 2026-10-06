const { query } = require('../../config/database');
const { publishEvent } = require('../websocket/publisher');

async function getMessageAuthority(messageId, userId) {
  const result = await query(
    `SELECT m.id, m.conversation_id, c.type, cm.role
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN conversation_members cm
       ON cm.conversation_id = m.conversation_id AND cm.user_id = $2
     WHERE m.id = $1 AND m.is_deleted = FALSE`,
    [messageId, userId]
  );
  if (!result.rows.length) {
    throw { status: 403, message: 'الرسالة غير متاحة لك', code: 'MESSAGE_FORBIDDEN' };
  }
  const context = result.rows[0];
  if (context.type === 'group' && context.role !== 'admin') {
    throw { status: 403, message: 'مشرف المجموعة فقط يقدر يثبت الرسائل', code: 'MESSAGE_PIN_FORBIDDEN' };
  }
  return context;
}

async function pinMessage(messageId, userId) {
  const context = await getMessageAuthority(messageId, userId);
  const result = await query(
    `UPDATE messages
     SET is_pinned = TRUE, pinned_by = $1, pinned_at = NOW(), updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [userId, messageId]
  );
  await publishEvent('ws:event', {
    type: 'message:pinned',
    roomId: context.conversation_id,
    payload: result.rows[0],
  });
  return result.rows[0];
}

async function unpinMessage(messageId, userId) {
  const context = await getMessageAuthority(messageId, userId);
  const result = await query(
    `UPDATE messages
     SET is_pinned = FALSE, pinned_by = NULL, pinned_at = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [messageId]
  );
  await publishEvent('ws:event', {
    type: 'message:unpinned',
    roomId: context.conversation_id,
    payload: result.rows[0],
  });
  return result.rows[0];
}

async function listPinnedMessages(conversationId, userId) {
  const member = await query(
    `SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (!member.rows.length) {
    throw { status: 403, message: 'لست عضواً في هذه المحادثة', code: 'CONVERSATION_FORBIDDEN' };
  }
  const result = await query(
    `SELECT
       m.*, u.username, u.display_name, u.avatar_url
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = $1 AND m.is_pinned = TRUE AND m.is_deleted = FALSE
     ORDER BY m.pinned_at DESC
     LIMIT 100`,
    [conversationId]
  );
  return result.rows;
}

module.exports = { pinMessage, unpinMessage, listPinnedMessages };
