function isOtpVerificationEnabled(env = process.env) {
  return env.SKIP_OTP_VERIFICATION !== 'true';
}

function getSecurityRuntimeConfig(env = process.env) {
  return {
    otpVerificationEnabled: isOtpVerificationEnabled(env),
  };
}

module.exports = { isOtpVerificationEnabled, getSecurityRuntimeConfig };
