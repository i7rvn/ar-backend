// ═══════════════════════════════════════════════════════════════
// AR App — إعدادات الحساب: تغيير كلمة المرور، تغيير البريد بخطوتين،
// السجل الأمني الشخصي، الحسابات المرتبطة، وحذف الحساب المتدرج
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const argon2 = require('argon2');
const { authenticate } = require('../../middleware/auth');
const { query } = require('../../config/database');
const { blacklistToken, setOTP, getOTP, deleteOTP, deleteCache } = require('../../config/redis');
const { sendOTPEmail } = require('../../config/email');
const { validateNewPassword, recordPasswordChange, hashPassword } = require('../auth/password.service');
const { verifyTOTPLogin } = require('../twofa/twofa.service');
const { getActivityHistory, logActivity } = require('./activityHistory.service');
const { listLinkedAccounts } = require('./linkedAccounts.service');
const { requestAccountDeletion, cancelDeletionIfExists } = require('./accountDeletion.service');

const router = express.Router();
router.use(authenticate);

// ─── تغيير كلمة المرور ───────────────────────────────────────
// إذا كان التحقق بخطوتين مفعّلاً، كود TOTP إجباري بالإضافة لكلمة
// المرور الحالية
router.put('/password', async (req, res) => {
  const { currentPassword, newPassword, totpCode, logoutAllDevices } = req.body;

  const userResult = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  const isValid = await argon2.verify(userResult.rows[0].password_hash, currentPassword).catch(() => false);
  if (!isValid) {
    return res.status(401).json({ success: false, message: 'كلمة المرور الحالية غير صحيحة' });
  }

  const totpValid = await verifyTOTPLogin(req.user.id, totpCode);
  if (!totpValid) {
    return res.status(401).json({ success: false, message: 'كود التحقق غير صحيح' });
  }

  const check = await validateNewPassword(req.user.id, newPassword, [req.user.username, req.user.email]);
  if (!check.valid) {
    return res.status(400).json({ success: false, message: check.reason });
  }

  const newHash = await hashPassword(newPassword);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.user.id]);
  await recordPasswordChange(req.user.id, newHash);
  await logActivity(req.user.id, 'password_changed', req);

  if (logoutAllDevices) {
    await blacklistToken(req.token, 7 * 24 * 3600);
    await query(`UPDATE sessions SET is_active = FALSE WHERE user_id = $1`, [req.user.id]);
  }

  res.json({ success: true, message: 'تم تغيير كلمة المرور' });
});

// ─── تغيير البريد الإلكتروني (خطوتان: تأكيد البريد القديم ثم الجديد) ──
router.post('/email/request-change', async (req, res) => {
  const { newEmail } = req.body;

  const { canRegisterWithEmail } = require('../users/linkedAccounts.service');
  const emailCheck = await canRegisterWithEmail(newEmail);
  if (!emailCheck.allowed) {
    return res.status(409).json({
      success: false,
      message: `لا يمكن استخدام هذا البريد، الحد الأقصى ${emailCheck.max} حسابات لكل بريد إلكتروني`,
    });
  }

  const userResult = await query(`SELECT email FROM users WHERE id = $1`, [req.user.id]);
  const oldEmail = userResult.rows[0].email;

  const otpOld = Math.floor(100000 + Math.random() * 900000).toString();
  const otpNew = Math.floor(100000 + Math.random() * 900000).toString();

  await setOTP(`email_change_old:${req.user.id}`, otpOld);
  await setOTP(`email_change_new:${req.user.id}`, otpNew);
  await query(`UPDATE users SET pending_email = $1 WHERE id = $2`, [newEmail, req.user.id]);

  await sendOTPEmail(oldEmail, otpOld);
  await sendOTPEmail(newEmail, otpNew);

  res.json({ success: true, message: 'تم إرسال رمزي تحقق إلى بريدك الحالي والجديد' });
});

router.post('/email/confirm-change', async (req, res) => {
  const { oldEmailCode, newEmailCode } = req.body;

  const storedOld = await getOTP(`email_change_old:${req.user.id}`);
  const storedNew = await getOTP(`email_change_new:${req.user.id}`);

  if (!storedOld || !storedNew) {
    return res.status(400).json({ success: false, message: 'انتهت صلاحية طلب تغيير البريد، أعد المحاولة' });
  }
  if (storedOld !== oldEmailCode || storedNew !== newEmailCode) {
    return res.status(400).json({ success: false, message: 'أحد الرمزين غير صحيح' });
  }

  const userResult = await query(`SELECT pending_email FROM users WHERE id = $1`, [req.user.id]);
  const newEmail = userResult.rows[0].pending_email;
  if (!newEmail) {
    return res.status(400).json({ success: false, message: 'لا يوجد طلب تغيير بريد قائم' });
  }

  const oldEmailResult = await query(`SELECT email FROM users WHERE id = $1`, [req.user.id]);
  const previousEmail = oldEmailResult.rows[0].email;

  await query(
    `UPDATE users SET email = $1, pending_email = NULL, updated_at = NOW() WHERE id = $2`,
    [newEmail, req.user.id]
  );
  await query(`DELETE FROM linked_accounts WHERE email = $1 AND user_id = $2`, [previousEmail, req.user.id]);
  const { linkAccount } = require('../users/linkedAccounts.service');
  await linkAccount(newEmail, req.user.id);
  await deleteOTP(`email_change_old:${req.user.id}`);
  await deleteOTP(`email_change_new:${req.user.id}`);
  await logActivity(req.user.id, 'email_changed', req, { to: newEmail });

  res.json({ success: true, message: 'تم تغيير البريد الإلكتروني' });
});

// ─── السجل الأمني الشخصي ──────────────────────────────────────
router.get('/security-log', async (req, res) => {
  const result = await query(
    `SELECT event_type, ip_address, severity, created_at
     FROM security_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ success: true, log: result.rows });
});

// ─── سجل تغييرات الحساب ────────────────────────────────────────
router.get('/activity-history', async (req, res) => {
  const history = await getActivityHistory(req.user.id, 50);
  res.json({ success: true, history });
});

// ─── الحسابات المرتبطة بنفس البريد ──────────────────────────────
router.get('/linked-accounts', async (req, res) => {
  const userResult = await query(`SELECT email FROM users WHERE id = $1`, [req.user.id]);
  const accounts = await listLinkedAccounts(userResult.rows[0].email);
  res.json({ success: true, accounts });
});

// ─── طلب حذف الحساب (متدرج، قابل للإلغاء) ──────────────────────
router.post('/delete-request', async (req, res) => {
  await requestAccountDeletion(req.user.id);
  res.json({ success: true, message: 'تم استلام طلب حذف حسابك، يمكنك إلغاؤه في أي وقت قبل انتهاء المهلة' });
});

router.post('/delete-cancel', async (req, res) => {
  await cancelDeletionIfExists(req.user.id);
  res.json({ success: true, message: 'تم إلغاء طلب حذف الحساب' });
});

// ─── الخصوصية ──────────────────────────────────────────────────
router.get('/privacy', async (req, res) => {
  const result = await query(
    `SELECT who_can_message, is_private FROM users WHERE id = $1`,
    [req.user.id]
  );
  res.json({ success: true, privacy: result.rows[0] });
});

router.put('/privacy', async (req, res) => {
  const { whoCanMessage, isPrivate } = req.body;

  if (whoCanMessage && !['everyone', 'followers'].includes(whoCanMessage)) {
    return res.status(400).json({ success: false, message: 'قيمة غير صالحة' });
  }

  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (whoCanMessage) { updates.push(`who_can_message = $${paramIndex++}`); values.push(whoCanMessage); }
  if (typeof isPrivate === 'boolean') { updates.push(`is_private = $${paramIndex++}`); values.push(isPrivate); }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, message: 'لم يُرسَل أي تعديل صالح' });
  }

  values.push(req.user.id);
  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`, values);
  await deleteCache(`profile:${req.user.username}`);
  res.json({ success: true, message: 'تم تحديث إعدادات الخصوصية' });
});

module.exports = router;
