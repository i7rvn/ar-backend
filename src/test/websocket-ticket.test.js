const test = require('node:test')
const assert = require('node:assert/strict')
const { createWebSocketTicket, consumeWebSocketTicket, TICKET_TTL_SECONDS } = require('../utils/websocketTicket')

test('WebSocket tickets are short-lived and single-use', async () => {
  const values = new Map()
  const fakeRedis = {
    async setEx(key, ttl, value) { values.set(key, { ttl, value }) },
    async getDel(key) { const item = values.get(key); values.delete(key); return item?.value ?? null },
    async get(key) { return values.get(key)?.value ?? null },
    async del(key) { values.delete(key) },
  }
  const ticket = await createWebSocketTicket({ userId: 'u', deviceId: 'd', accessToken: 'access' }, fakeRedis)
  assert.equal(ticket.length, 43)
  const stored = values.get('ws_ticket:' + ticket)
  assert.equal(stored.ttl, TICKET_TTL_SECONDS)
  assert.deepEqual(await consumeWebSocketTicket(ticket, fakeRedis), { userId: 'u', deviceId: 'd', accessToken: 'access' })
  assert.equal(await consumeWebSocketTicket(ticket, fakeRedis), null)
})

test('malformed WebSocket tickets are rejected without Redis lookup', async () => {
  let called = false
  const fakeRedis = { getDel: async () => { called = true; return null } }
  assert.equal(await consumeWebSocketTicket('short', fakeRedis), null)
  assert.equal(called, false)
})