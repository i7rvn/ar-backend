const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { query } = require('../../config/database');
const { verifyPassword } = require('../auth/password.service');
const { verifyTOTPLogin } = require('../twofa/twofa.service');
const { checkAccountLock, recordFailedAttempt, clearFailedAttempts } = require('../../middleware/accountLock');
const { sendAlert } = require('../../config/telegram');

// حد صارم خاص بدخول الأدمن (أشد المسارات حساسية بالنظام كامل)،
// بالإضافة إلى القفل التدريجي أدناه - طبقتا دفاع منفصلتان
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'محاولات دخول كثيرة، انتظر 15 دقيقة.', code: 'ADMIN_LOGIN_RATE_LIMIT' },
});

// دخول أدمن — يفرض 2FA إجباري إذا totp_required = TRUE
router.post('/login', adminLoginLimiter, checkAccountLock, async (req, res) => {
 const { email, password, totpCode } = req.body;

 const result = await query(
 `SELECT a.id AS admin_id, a.is_owner, a.totp_required, u.id AS user_id, u.password_hash
 FROM admins a JOIN users u ON u.id = a.user_id
 WHERE u.email = $1`,
 [email]
 );

 if (result.rows.length === 0 || !(await verifyPassword(result.rows[0].password_hash, password))) {
 await recordFailedAttempt(req.lockKey);
 return res.status(401).json({ success: false, message: 'بيانات دخول خاطئة', code: 'INVALID_CREDENTIALS' });
 }

 const admin = result.rows[0];

 if (admin.totp_required) {
 if (!totpCode) {
 return res.status(200).json({ success: false, requiresTOTP: true, code: 'TOTP_REQUIRED' });
 }
 const totpValid = await verifyTOTPLogin(admin.user_id, totpCode);
 if (!totpValid) {
 await recordFailedAttempt(req.lockKey);
 return res.status(401).json({ success: false, message: 'كود 2FA خاطئ', code: 'INVALID_2FA' });
 }
 }

 await clearFailedAttempts(req.lockKey);

 const token = jwt.sign(
 { adminId: admin.admin_id, userId: admin.user_id, jti: crypto.randomUUID() },
 process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET,
 { expiresIn: '8h' }
 );

 await sendAlert(`دخول أدمن جديد: ${email}`, 'info');
 res.json({ success: true, token });
});

module.exports = router;
