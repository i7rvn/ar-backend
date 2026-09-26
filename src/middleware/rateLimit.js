const rateLimit = require('express-rate-limit');

// ─── الحد العام (100 طلب / 15 دقيقة) ─────────────────────────
const globalLimiter = rateLimit({
 windowMs: 15 * 60 * 1000,
 max: 100,
 standardHeaders: true,
 legacyHeaders: false,
 message: {
 success: false,
 message: 'طلبات كثيرة جداً، انتظر قليلاً ثم حاول مجدداً.',
 code: 'RATE_LIMIT_EXCEEDED',
 },
});

// ─── حد المصادقة (10 طلبات / 15 دقيقة) ──────────────────────
const authLimiter = rateLimit({
 windowMs: 15 * 60 * 1000,
 max: 10,
 message: {
 success: false,
 message: 'محاولات تسجيل دخول كثيرة، انتظر 15 دقيقة.',
 code: 'AUTH_RATE_LIMIT',
 },
});

// ─── حد OTP (5 طلبات / ساعة) ─────────────────────────────────
const otpLimiter = rateLimit({
 windowMs: 60 * 60 * 1000,
 max: 5,
 message: {
 success: false,
 message: 'طلبت كوداً كثيراً، انتظر ساعة.',
 code: 'OTP_RATE_LIMIT',
 },
});

// ─── حد الأدمن (30 طلب / دقيقة) ─────────────────────────────
const adminLimiter = rateLimit({
 windowMs: 60 * 1000,
 max: 30,
 message: {
 success: false,
 message: 'طلبات كثيرة على لوحة الإدارة.',
 code: 'ADMIN_RATE_LIMIT',
 },
});

module.exports = { globalLimiter, authLimiter, otpLimiter, adminLimiter };
