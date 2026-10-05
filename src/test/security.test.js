const test = require('node:test');
const assert = require('node:assert/strict');
const { assertProductionSecurityConfig } = require('../config/security');

test('production rejects OTP bypass', () => {
  assert.throws(
    () => assertProductionSecurityConfig({
      NODE_ENV: 'production',
      SKIP_OTP_VERIFICATION: 'true',
    }),
    /SKIP_OTP_VERIFICATION=true is forbidden in production/
  );
});

test('development may use OTP bypass for local debugging', () => {
  assert.doesNotThrow(() => assertProductionSecurityConfig({
    NODE_ENV: 'development',
    SKIP_OTP_VERIFICATION: 'true',
  }));
});

test('production without bypass is allowed', () => {
  assert.doesNotThrow(() => assertProductionSecurityConfig({
    NODE_ENV: 'production',
    SKIP_OTP_VERIFICATION: 'false',
  }));
});
