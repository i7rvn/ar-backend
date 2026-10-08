const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeMatchingCode } = require('../utils/recoveryCodeClaim');

test('recovery code claim succeeds only after a hash match', async () => {
  const claimed = [];
  const result = await consumeMatchingCode(
    [{ id: 'code-1', code_hash: 'hash-1' }],
    'plain-code',
    async (hash, code) => hash === 'hash-1' && code === 'plain-code',
    async (id) => { claimed.push(id); return true; },
  );

  assert.equal(result, true);
  assert.deepEqual(claimed, ['code-1']);
});

test('recovery code claim rejects a non-matching code without consuming it', async () => {
  let claimCalls = 0;
  const result = await consumeMatchingCode(
    [{ id: 'code-1', code_hash: 'hash-1' }],
    'wrong-code',
    async () => false,
    async () => { claimCalls += 1; return true; },
  );

  assert.equal(result, false);
  assert.equal(claimCalls, 0);
});

test('two concurrent uses of one recovery code can only claim it once', async () => {
  let used = false;
  const rows = [{ id: 'code-1', code_hash: 'hash-1' }];
  const verify = async () => true;
  const claim = async () => {
    if (used) return false;
    used = true;
    return true;
  };

  const results = await Promise.all([
    consumeMatchingCode(rows, 'same-code', verify, claim),
    consumeMatchingCode(rows, 'same-code', verify, claim),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
});

