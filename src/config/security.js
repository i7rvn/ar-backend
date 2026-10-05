function assertProductionSecurityConfig(env = process.env) {
  if (env.NODE_ENV === 'production' && env.SKIP_OTP_VERIFICATION === 'true') {
    throw new Error(
      'SECURITY CONFIGURATION ERROR: SKIP_OTP_VERIFICATION=true is forbidden in production'
    );
  }
}

module.exports = { assertProductionSecurityConfig };
