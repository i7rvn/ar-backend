const crypto = require('crypto');
const { client } = require('../config/redis');

const TICKET_TTL_SECONDS = 30;
const KEY_PREFIX = 'ws_ticket:';

async function createWebSocketTicket({ userId, deviceId, accessToken }) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  await client.setEx(
    KEY_PREFIX + ticket,
    TICKET_TTL_SECONDS,
    JSON.stringify({ userId, deviceId, accessToken }),
  );
  return ticket;
}

async function consumeWebSocketTicket(ticket) {
  if (typeof ticket !== 'string' || ticket.length < 40 || ticket.length > 100) return null;
  const key = KEY_PREFIX + ticket;
  if (typeof client.getDel === 'function') {
    const raw = await client.getDel(key);
    return raw ? JSON.parse(raw) : null;
  }
  const raw = await client.get(key);
  if (!raw) return null;
  await client.del(key);
  return JSON.parse(raw);
}

module.exports = { TICKET_TTL_SECONDS, createWebSocketTicket, consumeWebSocketTicket };