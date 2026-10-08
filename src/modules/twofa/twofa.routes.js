const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const twofaService = require('./twofa.service');
const { generateRecoveryCodes, remainingCodesCount } = require('./recoveryCodes.service');
const { verifyPassword } = require('../auth/password.service');
const { query } = require('../../config/database');
const rateLimit = require('express-rate-limit');

const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'محاولات كثيرة، انتظر قليلاً ثم حاول مجدداً', code: 'TWO_FACTOR_RATE_LIMIT' },
});

async function verifyReauthentication(userId, password, totpCode) {
  if (typeof password !== 'string' || !password || typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) {
    return false;
  }

  const userResult = await query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (!userResult.rows.length || !(await verifyPassword(userResult.rows[0].password_hash, password))) {
    return false;
  }

  return twofaService.verifyTOTPLogin(userId, totpCode);
}

// بدء تفعيل 2FA — يرجّع QR Code
router.post('/setup', authenticate, twoFactorLimiter, async (req, res) => {
  if (await twofaService.isTOTPEnabled(req.user.id)) {
    const valid = await verifyReauthentication(req.user.id, req.body?.password, req.body?.totpCode);
    if (!valid) {
      return res.status(403).json({ success: false, message: 'أدخل كلمة المرور ورمز المصادقة الحالي لإعادة إعداد 2FA', code: 'TWO_FACTOR_REAUTH_REQUIRED' });
    }
  }
  const { secret, qrCodeDataURL } = await twofaService.setupTOTP(req.user.id, req.user.email);
  res.json({ success: true, secret, qrCode: qrCodeDataURL });
});

// تأكيد التفعيل بكود من Google Authenticator
router.post('/confirm', authenticate, twoFactorLimiter, async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) {
    return res.status(400).json({ success: false, message: 'أدخل رمزاً مكوناً من 6 أرقام', code: 'INVALID_2FA_CODE' });
  }
  const result = await twofaService.confirmTOTP(req.user.id, token);
  if (!result.valid) {
    return res.status(400).json({ success: false, message: result.reason, code: 'INVALID_2FA_CODE' });
  }

  // إصلاح ثغرة كانت موجودة: لو هذا المستخدم أدمن، totp_required كان
  // يبقى FALSE للأبد بعد هذي النقطة (ما كاين حتى route يحوّلها TRUE)،
  // فيصير الأدمن محجوب من /admin/auth/login نهائياً برسالة "حساب غير
  // مُعَدّ بشكل صحيح" رغم إتمامه لـ 2FA بنجاح. نصلحها هنا تلقائياً.
  await query(`UPDATE admins SET totp_required = TRUE WHERE user_id = $1`, [req.user.id]);
  const recoveryCodes = await generateRecoveryCodes(req.user.id);
  res.json({ success: true, message: 'تم تفعيل التحقق بخطوتين', recoveryCodes });
});

router.get('/status', authenticate, async (req, res) => {
  const enabled = await twofaService.isTOTPEnabled(req.user.id);
  const remaining = enabled ? await remainingCodesCount(req.user.id) : 0;
  res.json({ success: true, enabled, remainingRecoveryCodes: remaining });
});

// تعطيل 2FA — يتطلب كلمة المرور + كود تأكيد حتى لا يعطّله من سرق الجلسة فقط
router.post('/disable', authenticate, twoFactorLimiter, async (req, res) => {
  const { password, totpCode } = req.body || {};

  if (!(await twofaService.isTOTPEnabled(req.user.id))) {
    return res.status(400).json({ success: false, message: 'التحقق بخطوتين غير مفعّل' });
  }

  if (!(await verifyReauthentication(req.user.id, password, totpCode))) {
    return res.status(403).json({ success: false, message: 'كلمة المرور أو رمز المصادقة غير صحيح', code: 'TWO_FACTOR_REAUTH_FAILED' });
  }

  await query(`UPDATE totp_secrets SET is_enabled = FALSE WHERE user_id = $1`, [req.user.id]);
  await query(`DELETE FROM recovery_codes WHERE user_id = $1`, [req.user.id]);
  res.json({ success: true, message: 'تم تعطيل التحقق بخطوتين' });
});

// توليد أكواد استرجاع جديدة (تُبطل القديمة تلقائياً)
router.post('/recovery-codes/regenerate', authenticate, twoFactorLimiter, async (req, res) => {
  const enabled = await twofaService.isTOTPEnabled(req.user.id);
  if (!enabled) {
    return res.status(400).json({ success: false, message: 'التحقق بخطوتين غير مفعّل' });
  }
  if (!(await verifyReauthentication(req.user.id, req.body?.password, req.body?.totpCode))) {
    return res.status(403).json({ success: false, message: 'كلمة المرور أو رمز المصادقة غير صحيح', code: 'TWO_FACTOR_REAUTH_FAILED' });
  }
  const recoveryCodes = await generateRecoveryCodes(req.user.id);
  res.json({ success: true, recoveryCodes });
});

module.exports = router;

