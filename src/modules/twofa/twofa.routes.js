const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const twofaService = require('./twofa.service');
const { generateRecoveryCodes, remainingCodesCount } = require('./recoveryCodes.service');
const { verifyPassword } = require('../auth/password.service');
const { query } = require('../../config/database');

// بدء تفعيل 2FA — يرجّع QR Code
router.post('/setup', authenticate, async (req, res) => {
  const { secret, qrCodeDataURL } = await twofaService.setupTOTP(req.user.id, req.user.email);
  res.json({ success: true, secret, qrCode: qrCodeDataURL });
});

// تأكيد التفعيل بكود من Google Authenticator
router.post('/confirm', authenticate, async (req, res) => {
  const { token } = req.body;
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
router.post('/disable', authenticate, async (req, res) => {
  const { password, totpCode } = req.body;

  const userResult = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  const passwordValid = await verifyPassword(userResult.rows[0].password_hash, password);
  if (!passwordValid) {
    return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
  }

  const totpValid = await twofaService.verifyTOTPLogin(req.user.id, totpCode);
  if (!totpValid) {
    return res.status(400).json({ success: false, message: 'كود التحقق غير صحيح' });
  }

  await query(`UPDATE totp_secrets SET is_enabled = FALSE WHERE user_id = $1`, [req.user.id]);
  await query(`DELETE FROM recovery_codes WHERE user_id = $1`, [req.user.id]);
  res.json({ success: true, message: 'تم تعطيل التحقق بخطوتين' });
});

// توليد أكواد استرجاع جديدة (تُبطل القديمة تلقائياً)
router.post('/recovery-codes/regenerate', authenticate, async (req, res) => {
  const enabled = await twofaService.isTOTPEnabled(req.user.id);
  if (!enabled) {
    return res.status(400).json({ success: false, message: 'التحقق بخطوتين غير مفعّل' });
  }
  const recoveryCodes = await generateRecoveryCodes(req.user.id);
  res.json({ success: true, recoveryCodes });
});

module.exports = router;
