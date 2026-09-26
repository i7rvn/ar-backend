// ═══════════════════════════════════════════════════════════════
// AR App — خادم WebSocket (Node.js فقط، بلا خدمة Go منفصلة)
//
// ملاحظة تصميمية: كانت هذه الوظيفة بخدمة Go مستقلة تستمع لقناة
// Redis وتوزّع الرسائل على العملاء المتصلين. تم نقلها هنا مباشرة
// داخل عملية Node.js نفسها عبر مكتبة ws، بلا أي تغيير على واجهة
// النشر (publisher.js يبقى كما هو، ينشر على نفس قناة "ws:event").
// ═══════════════════════════════════════════════════════════════

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const url = require('url');
const { client: redisClient } = require('../../config/redis');
const logger = require('../../config/logger');

// userId -> Set(ws) لدعم عدة أجهزة متصلة بنفس الوقت لنفس المستخدم
const userConnections = new Map();
// roomId (محادثة) -> Set(ws)
const roomConnections = new Map();

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

// ─── تهيئة الخادم فوق نفس http.Server التي يستخدمها Express ────
function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname, query } = url.parse(request.url, true);
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(query.token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.userId = userId;
      ws.rooms = new Set();
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    addToMap(userConnections, ws.userId, ws);
    sendJSON(ws, 'connected', {});
    logger.info(`اتصال WebSocket جديد للمستخدم ${ws.userId}`);

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleClientMessage(ws, data);
    });

    ws.on('close', () => {
      removeFromMap(userConnections, ws.userId, ws);
      for (const roomId of ws.rooms) {
        removeFromMap(roomConnections, roomId, ws);
      }
    });
  });

  // ─── الاستماع لقناة Redis التي ينشر عليها publisher.js ────────
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

async function persistDelivery(messageId, userId) {
  if (!messageId) return;
  try {
    const { query } = require('../../config/database');
    await query(
      `INSERT INTO message_deliveries (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [messageId, userId]
    );
  } catch (err) {
    logger.error('فشل تسجيل إيصال التسليم:', err.message);
  }
}

async function persistRead(conversationId, userId) {
  if (!conversationId) return;
  try {
    const messagesService = require('../messages/messages.service');
    await messagesService.markMessagesRead(conversationId, userId);
  } catch (err) {
    logger.error('فشل تسجيل إيصال القراءة:', err.message);
  }
}

function handleClientMessage(ws, data) {
  switch (data.type) {
    case 'join:room':
      addToMap(roomConnections, data.payload.conversationId, ws);
      ws.rooms.add(data.payload.conversationId);
      break;
    case 'leave:room':
      removeFromMap(roomConnections, data.payload.conversationId, ws);
      ws.rooms.delete(data.payload.conversationId);
      break;
    case 'typing:start':
    case 'typing:stop':
      broadcastToRoom(data.payload.conversationId, data.type, {
        userId: ws.userId,
        conversationId: data.payload.conversationId,
      }, ws);
      break;
    case 'message:delivered':
      persistDelivery(data.payload.messageId, ws.userId);
      broadcastToRoom(data.payload.conversationId, 'message:delivered', {
        userId: ws.userId,
        messageId: data.payload.messageId,
        conversationId: data.payload.conversationId,
      }, ws);
      break;
    case 'message:read':
      persistRead(data.payload.conversationId, ws.userId);
      broadcastToRoom(data.payload.conversationId, 'message:read', {
        userId: ws.userId,
        conversationId: data.payload.conversationId,
      }, ws);
      break;
    case 'ping':
      sendJSON(ws, 'pong', {});
      break;
    default:
      break;
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

// ─── توزيع الحدث الوارد من Redis على العملاء المناسبين ─────────
function broadcastEvent(event) {
  if (event.roomId) {
    broadcastToRoom(event.roomId, event.type, event.payload);
  } else if (event.userId) {
    broadcastToUser(event.userId, event.type, event.payload);
  }
}

function getOnlineUserIds() {
  return Array.from(userConnections.keys());
}

module.exports = { attachWebSocketServer, getOnlineUserIds };
