const { WebSocketServer } = require('ws');
const url = require('url');
const { z } = require('zod');
const { client: redisClient } = require('../../config/redis');
const logger = require('../../config/logger');
const { authenticateAccessToken } = require('../../middleware/auth');
const messagesService = require('../messages/messages.service');

const userConnections = new Map();
const roomConnections = new Map();

const MAX_PAYLOAD_BYTES = 64 * 1024;
const SESSION_REVALIDATION_MS = 30 * 1000;
const DEFAULT_EVENTS_PER_SECOND = 30;
const MAX_ROOM_JOINS_PER_MINUTE = 20;

const clientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join:room'),
    payload: z.object({ conversationId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    type: z.literal('leave:room'),
    payload: z.object({ conversationId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    type: z.union([z.literal('typing:start'), z.literal('typing:stop')]),
    payload: z.object({ conversationId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    type: z.literal('message:delivered'),
    payload: z.object({
      conversationId: z.string().uuid(),
      messageId: z.string().uuid(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal('message:read'),
    payload: z.object({ conversationId: z.string().uuid() }).strict(),
  }).strict(),
  z.object({
    type: z.literal('ping'),
    payload: z.object({}).strict().optional(),
  }).strict(),
]);

function addToMap(map, key, ws) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(ws);
}

function removeFromMap(map, key, ws) {
  const set = map.get(key);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) map.delete(key);
}

function sendJSON(ws, type, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function rejectUpgrade(socket, statusCode = 401, message = 'Unauthorized') {
  if (!socket.destroyed) {
    socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }
}

function checkRateLimit(ws, type) {
  const now = Date.now();

  if (!ws.rateWindow || now - ws.rateWindow.startedAt >= 1000) {
    ws.rateWindow = { startedAt: now, count: 0, joinsStartedAt: now, joins: 0 };
  }

  ws.rateWindow.count += 1;
  if (ws.rateWindow.count > DEFAULT_EVENTS_PER_SECOND) {
    return false;
  }

  if (type === 'join:room') {
    if (now - ws.rateWindow.joinsStartedAt >= 60 * 1000) {
      ws.rateWindow.joinsStartedAt = now;
      ws.rateWindow.joins = 0;
    }
    ws.rateWindow.joins += 1;
    if (ws.rateWindow.joins > MAX_ROOM_JOINS_PER_MINUTE) {
      return false;
    }
  }

  return true;
}

async function validateSocketSession(ws, force = false) {
  if (!force && ws.sessionValidatedAt && Date.now() - ws.sessionValidatedAt < SESSION_REVALIDATION_MS) {
    return { user: ws.user, deviceId: ws.deviceId };
  }
  const session = await authenticateAccessToken(ws.token);
  ws.sessionValidatedAt = Date.now();
  ws.deviceId = session.deviceId;
  return session;
}

async function persistDelivery(messageId, conversationId, userId) {
  const { query } = require('../../config/database');

  const message = await query(
    `SELECT m.conversation_id
     FROM messages m
     JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
       AND cm.user_id = $2
     WHERE m.id = $1 AND m.conversation_id = $3`,
    [messageId, userId, conversationId]
  );

  if (!message.rows.length) {
    throw { status: 403, message: 'غير مسموح بتحديث هذه الرسالة', code: 'MESSAGE_FORBIDDEN' };
  }

  await query(
    `INSERT INTO message_deliveries (message_id, user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [messageId, userId]
  );
}

async function handleClientMessage(ws, rawData) {
  let parsed;
  try {
    parsed = JSON.parse(rawData.toString());
  } catch {
    sendJSON(ws, 'error', { code: 'INVALID_JSON', message: 'البيانات غير صالحة' });
    return;
  }

  if (!checkRateLimit(ws, parsed?.type)) {
    sendJSON(ws, 'error', { code: 'RATE_LIMITED', message: 'طلبات كثيرة، حاول لاحقاً' });
    return;
  }

  const validation = clientEventSchema.safeParse(parsed);
  if (!validation.success) {
    sendJSON(ws, 'error', { code: 'INVALID_EVENT', message: 'صيغة الحدث غير صالحة' });
    return;
  }

  const data = validation.data;

  try {
    await validateSocketSession(ws);

    switch (data.type) {
      case 'join:room':
        await messagesService.assertConversationMember(data.payload.conversationId, ws.userId);
        addToMap(roomConnections, data.payload.conversationId, ws);
        ws.rooms.add(data.payload.conversationId);
        sendJSON(ws, 'room:joined', { conversationId: data.payload.conversationId });
        break;

      case 'leave:room':
        removeFromMap(roomConnections, data.payload.conversationId, ws);
        ws.rooms.delete(data.payload.conversationId);
        break;

      case 'typing:start':
      case 'typing:stop':
        await messagesService.assertConversationMember(data.payload.conversationId, ws.userId);
        if (!ws.rooms.has(data.payload.conversationId)) return;
        broadcastToRoom(data.payload.conversationId, data.type, {
          userId: ws.userId,
          conversationId: data.payload.conversationId,
        }, ws);
        break;

      case 'message:delivered':
        await persistDelivery(
          data.payload.messageId,
          data.payload.conversationId,
          ws.userId
        );
        if (!ws.rooms.has(data.payload.conversationId)) return;
        broadcastToRoom(data.payload.conversationId, 'message:delivered', {
          userId: ws.userId,
          messageId: data.payload.messageId,
          conversationId: data.payload.conversationId,
        }, ws);
        break;

      case 'message:read':
        await messagesService.assertConversationMember(data.payload.conversationId, ws.userId);
        if (!ws.rooms.has(data.payload.conversationId)) return;
        await messagesService.markMessagesRead(data.payload.conversationId, ws.userId);
        broadcastToRoom(data.payload.conversationId, 'message:read', {
          userId: ws.userId,
          conversationId: data.payload.conversationId,
        }, ws);
        break;

      case 'ping':
        sendJSON(ws, 'pong', {});
        break;
    }
  } catch (err) {
    if (err?.code === 'TOKEN_EXPIRED' || err?.code === 'TOKEN_REVOKED' ||
        err?.code === 'TOKEN_VERSION_MISMATCH' || err?.code === 'SESSION_REVOKED' ||
        err?.code === 'ACCOUNT_BANNED') {
      sendJSON(ws, 'error', { code: err.code, message: err.message });
      ws.close(4001, 'session revoked');
      return;
    }

    sendJSON(ws, 'error', {
      code: err?.code || 'FORBIDDEN',
      message: err?.status === 403 ? (err.message || 'غير مسموح') : 'تعذر تنفيذ الطلب',
    });
  }
}

function broadcastToRoom(roomId, type, payload, exceptWs = null) {
  const set = roomConnections.get(roomId);
  if (!set) return;
  for (const ws of set) {
    if (ws !== exceptWs) sendJSON(ws, type, payload);
  }
}

function broadcastToUser(userId, type, payload) {
  const set = userConnections.get(userId);
  if (!set) return;
  for (const ws of set) sendJSON(ws, type, payload);
}

function broadcastEvent(event) {
  if (event.roomId) {
    broadcastToRoom(event.roomId, event.type, event.payload);
  } else if (event.userId) {
    broadcastToUser(event.userId, event.type, event.payload);
  }
}

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname, query } = url.parse(request.url, true);
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = Array.isArray(query.token) ? query.token[0] : query.token;
    if (typeof token !== 'string' || !token) {
      rejectUpgrade(socket, 401);
      return;
    }

    (async () => {
      let session;
      try {
        session = await authenticateAccessToken(token);
      } catch (err) {
        const status = err?.status === 403 ? 403 : 401;
        rejectUpgrade(socket, status);
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.userId = session.user.id;
        ws.user = session.user;
        ws.token = token;
        ws.deviceId = session.deviceId;
        ws.rooms = new Set();
        ws.rateWindow = { startedAt: Date.now(), count: 0, joinsStartedAt: Date.now(), joins: 0 };
        ws.sessionCheckTimer = setInterval(async () => {
          try {
            await validateSocketSession(ws, true);
          } catch (err) {
            ws.close(4001, 'session revoked');
          }
        }, SESSION_REVALIDATION_MS);
        ws.sessionCheckTimer.unref?.();
        wss.emit('connection', ws, request);
      });
    })().catch((err) => {
      logger.error('فشل تهيئة WebSocket:', err);
      rejectUpgrade(socket, 503, 'Service Unavailable');
    });
  });

  wss.on('connection', (ws) => {
    addToMap(userConnections, ws.userId, ws);
    sendJSON(ws, 'connected', {});
    logger.info(`اتصال WebSocket جديد للمستخدم ${ws.userId}`);

    ws.on('message', (raw) => {
      handleClientMessage(ws, raw).catch((err) => {
        logger.error('خطأ غير متوقع في رسالة WebSocket:', err);
        ws.close(1011, 'internal error');
      });
    });

    ws.on('close', () => {
      if (ws.sessionCheckTimer) clearInterval(ws.sessionCheckTimer);
      removeFromMap(userConnections, ws.userId, ws);
      for (const roomId of ws.rooms) {
        removeFromMap(roomConnections, roomId, ws);
      }
    });

    ws.on('error', (err) => {
      logger.warn(`خطأ WebSocket للمستخدم ${ws.userId}: ${err.message}`);
    });
  });

  const subscriber = redisClient.duplicate();
  subscriber.connect().then(() => {
    subscriber.subscribe('ws:event', (message) => {
      let event;
      try {
        event = JSON.parse(message);
      } catch {
        return;
      }
      broadcastEvent(event);
    });
  }).catch((err) => {
    logger.error('فشل الاشتراك بقناة WebSocket:', err.message);
  });

  return wss;
}

function getOnlineUserIds() {
  return Array.from(userConnections.keys());
}

module.exports = {
  attachWebSocketServer,
  getOnlineUserIds,
  clientEventSchema,
};
