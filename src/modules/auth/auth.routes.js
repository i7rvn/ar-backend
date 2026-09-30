const express = require('express');
const controller = require('./auth.controller');
const { validate } = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { authLimiter, otpLimiter } = require('../../middleware/rateLimit');
const { checkAccountLock } = require('../../middleware/accountLock');

const router = express.Router();

// ─── مسارات عامة ──────────────────────────────────────────────
router.post('/send-otp', otpLimiter, validate('sendOTP'), controller.sendOTP);
router.post('/verify-otp', authLimiter, validate('verifyOTP'), controller.verifyOTP);
router.post('/register', authLimiter, validate('register'), controller.register);
router.post('/login', authLimiter, checkAccountLock, validate('login'), controller.login);
router.post('/refresh-token', authLimiter, controller.refreshToken);
router.post('/forgot-password', otpLimiter, controller.forgotPassword);
router.post('/reset-password', authLimiter, controller.resetPassword);
router.post('/check-password-strength', controller.checkPasswordStrength);
router.post('/exchange-impersonation-code', authLimiter, controller.exchangeImpersonationCode);

// ─── مسارات محمية (تحتاج تسجيل دخول) ────────────────────────
router.post('/logout', authenticate, controller.logout);
router.get('/me', authenticate, controller.me);

module.exports = router;
