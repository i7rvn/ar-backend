const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isOtpVerificationEnabled,
  getSecurityRuntimeConfig,
} = require('../config/security');

test('OTP verification is enabled by default', () => {
  assert.equal(isOtpVerificationEnabled({}), true);
});

test('OTP verification can be skipped explicitly', () => {
  assert.equal(isOtpVerificationEnabled({ SKIP_OTP_VERIFICATION: 'true' }), false);
});

test('OTP bypass works in production only when explicitly configured', () => {
  assert.equal(
    getSecurityRuntimeConfig({
      NODE_ENV: 'production',
      SKIP_OTP_VERIFICATION: 'true',
    }).otpVerificationEnabled,
    false
  );
});

test('production keeps OTP verification enabled when bypass is not configured', () => {
  assert.equal(
    getSecurityRuntimeConfig({
      NODE_ENV: 'production',
      SKIP_OTP_VERIFICATION: 'false',
    }).otpVerificationEnabled,
    true
  );
});
