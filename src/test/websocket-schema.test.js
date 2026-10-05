const test = require('node:test');
const assert = require('node:assert/strict');
const { clientEventSchema } = require('../modules/websocket/server');

test('WebSocket accepts a valid room join event', () => {
  const result = clientEventSchema.safeParse({
    type: 'join:room',
    payload: { conversationId: '123e4567-e89b-12d3-a456-426614174000' },
  });
  assert.equal(result.success, true);
});

test('WebSocket rejects a room join with a non-UUID conversation id', () => {
  const result = clientEventSchema.safeParse({
    type: 'join:room',
    payload: { conversationId: 'not-a-uuid' },
  });
  assert.equal(result.success, false);
});

test('WebSocket rejects unknown fields in event payloads', () => {
  const result = clientEventSchema.safeParse({
    type: 'message:delivered',
    payload: {
      conversationId: '123e4567-e89b-12d3-a456-426614174000',
      messageId: '123e4567-e89b-12d3-a456-426614174001',
      extra: 'unexpected',
    },
  });
  assert.equal(result.success, false);
});


test('WebSocket rate limiter blocks excessive room joins in one minute', () => {
  const { checkRateLimit } = require('../modules/websocket/server');
  const ws = {};
  let allowed = 0;
  for (let i = 0; i < 20; i += 1) {
    if (checkRateLimit(ws, 'join:room')) allowed += 1;
  }
  assert.equal(allowed, 20);
  assert.equal(checkRateLimit(ws, 'join:room'), false);
});
