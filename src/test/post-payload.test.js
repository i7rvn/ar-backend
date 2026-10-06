const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeContentWarning } = require('../utils/postPayload');

test('content warning defaults when sensitive post has no warning', () => {
  assert.deepEqual(normalizeContentWarning(true, ''), {
    isSensitive: true,
    sensitiveWarning: 'قد يحتوي هذا المنشور على محتوى حساس.',
  });
});

test('non-sensitive posts do not retain a warning', () => {
  assert.deepEqual(normalizeContentWarning(false, 'warning'), {
    isSensitive: false,
    sensitiveWarning: null,
  });
});

test('content warning is capped at 200 characters', () => {
  assert.throws(
    () => normalizeContentWarning(true, 'x'.repeat(201)),
    (err) => err.code === 'SENSITIVE_WARNING_TOO_LONG'
  );
});
