const { query } = require('../../config/database');
const { publishEvent } = require('../websocket/publisher');

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😢', '😡', '😮', '👎'];

async function getMessageContext(messageId, userId) {
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
  return result.rows[0];
}

async function getMessageReactions(messageId, userId) {
  const context = await getMessageContext(messageId, userId);
  const result = await query(
    `SELECT reaction, COUNT(*)::int AS count,
            BOOL_OR(user_id = $2) AS reacted_by_me
     FROM message_reactions
     WHERE message_id = $1
     GROUP BY reaction
     ORDER BY count DESC, reaction ASC`,
    [messageId, userId]
  );
  return {
    messageId: context.id,
    reactions: result.rows,
  };
}

async function addMessageReaction(messageId, userId, reaction) {
  if (!ALLOWED_REACTIONS.includes(reaction)) {
    throw { status: 400, message: 'التفاعل غير مدعوم', code: 'INVALID_MESSAGE_REACTION' };
  }
  const context = await getMessageContext(messageId, userId);

  await query(
    `INSERT INTO message_reactions (message_id, user_id, reaction)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [messageId, userId, reaction]
  );

  const data = await getMessageReactions(messageId, userId);
  await publishEvent('ws:event', {
    type: 'message:reaction',
    roomId: context.conversation_id,
    payload: { messageId, userId, reaction, action: 'add' },
  });
  return data;
}

async function removeMessageReaction(messageId, userId, reaction) {
  if (!ALLOWED_REACTIONS.includes(reaction)) {
    throw { status: 400, message: 'التفاعل غير مدعوم', code: 'INVALID_MESSAGE_REACTION' };
  }
  const context = await getMessageContext(messageId, userId);

  const removed = await query(
    `DELETE FROM message_reactions
     WHERE message_id = $1 AND user_id = $2 AND reaction = $3
     RETURNING id`,
    [messageId, userId, reaction]
  );
  if (!removed.rows.length) {
    throw { status: 404, message: 'هذا التفاعل غير موجود', code: 'REACTION_NOT_FOUND' };
  }

  const data = await getMessageReactions(messageId, userId);
  await publishEvent('ws:event', {
    type: 'message:reaction',
    roomId: context.conversation_id,
    payload: { messageId, userId, reaction, action: 'remove' },
  });
  return data;
}

module.exports = {
  ALLOWED_REACTIONS,
  getMessageReactions,
  addMessageReaction,
  removeMessageReaction,
};
