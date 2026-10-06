const test = require('node:test');
const assert = require('node:assert/strict');

const { isOtpVerificationEnabled } = require('../config/security');
const { normalizeContentWarning } = require('../utils/postPayload');
const { normalizeVisibility } = require('../modules/posts/postVisibility');
const { validatePollInput } = require('../modules/polls/polls.service');
const { normalizePhrase, normalizeDurationDays } = require('../modules/filters/wordFilters.service');
const { validatePublicKeyJwk } = require('../modules/messages/e2eKeys.service');
const { resolvePublicAddress } = require('../modules/link-preview/linkPreview.service');

test('OTP mode is explicitly controllable', () => {
  assert.equal(isOtpVerificationEnabled({ SKIP_OTP_VERIFICATION: 'false' }), true);
  assert.equal(isOtpVerificationEnabled({ SKIP_OTP_VERIFICATION: 'true' }), false);
});

test('content warning normalizes and enforces length', () => {
  assert.deepEqual(normalizeContentWarning(true, ''), {
    isSensitive: true,
    sensitiveWarning: 'قد يحتوي هذا المنشور على محتوى حساس.',
  });
  assert.throws(() => normalizeContentWarning(true, 'x'.repeat(201)));
});

test('post visibility only accepts supported modes', () => {
  for (const value of ['public', 'unlisted', 'followers', 'mentioned']) {
    assert.equal(normalizeVisibility(value), value);
  }
  assert.throws(() => normalizeVisibility('friends'));
});

test('poll validation enforces options and duration', () => {
  assert.deepEqual(
    validatePollInput({
      options: ['A', 'B', 'C'],
      durationSeconds: 3600,
    }),
    { options: ['A', 'B', 'C'], durationSeconds: 3600 }
  );
  assert.throws(() => validatePollInput({ options: ['A'], durationSeconds: 3600 }));
  assert.throws(() => validatePollInput({ options: ['A', 'A'], durationSeconds: 3600 }));
  assert.throws(() => validatePollInput({ options: ['A', 'B'], durationSeconds: 30 }));
});

test('word filters normalize literally', () => {
  assert.equal(normalizePhrase('  Spoiler  '), 'spoiler');
  assert.equal(normalizeDurationDays(undefined), null);
  assert.equal(normalizeDurationDays('30'), 30);
  assert.throws(() => normalizePhrase('x'.repeat(81)));
  assert.throws(() => normalizeDurationDays(366));
});

test('E2E public key validation rejects invalid algorithms', () => {
  assert.throws(
    () => validatePublicKeyJwk({ kty: 'EC', alg: 'ECDH-ES' }),
    (err) => err.code === 'UNSUPPORTED_E2E_ALGORITHM'
  );
  assert.throws(
    () => validatePublicKeyJwk({ kty: 'RSA', alg: 'RSA-OAEP-256', n: 'invalid', e: 'AQAB' }),
    (err) => err.code === 'INVALID_E2E_PUBLIC_KEY'
  );
});

test('link preview blocks local host before DNS access', async () => {
  await assert.rejects(
    () => resolvePublicAddress('localhost'),
    (err) => err.code === 'PRIVATE_URL_BLOCKED'
  );
});
