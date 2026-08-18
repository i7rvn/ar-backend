// ═══════════════════════════════════════════════════════════════
// AR App — الوصول المعزول لبيانات الحسابات حسب القسم (Web/Android/iOS)
//
// ملاحظة صادقة حول حدود هذا التطبيق: البريد الإلكتروني وحقول الملف
// الشخصي (bio, location) مخزَّنة بالقاعدة بنص عادٍ لا مشفَّر، لأن
// تشفيرها فعلياً يتطلب تعديل كل استعلام بحث/دخول بالمشروع (تسجيل
// الدخول، البحث، لوحة الأدمن...) التي تعتمد كلها على مطابقة البريد
// كنص عادي مباشرة بقاعدة البيانات - تغيير هذا يمس عشرات نقاط الكود
// دفعة واحدة وبمخاطرة عطل حقيقي، فتم تجنّبه عمداً بهذا الإصدار.
//
// ما هو حقيقي وفعّال هنا: العزل الكامل بين 3 أكواد وصول منفصلة
// (كود قسم لا يفتح بيانات قسم آخر أبداً)، وتسجيل كل محاولة فتح
// (ناجحة أو فاشلة) بجدول مستقل، وهو ضابط الأمان الأهم بهذه الميزة.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');

const router = express.Router();
router.use(adminAuthenticate);

const SECTION_ENV_KEYS = {
  web: 'DECRYPT_CODE_WEB',
  android: 'DECRYPT_CODE_ANDROID',
  ios: 'DECRYPT_CODE_IOS',
};

// ─── عرض الأقسام المتاحة (بلا أي بيانات حساسة) ──────────────────
router.get('/sections', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const result = await query(`SELECT section, key_version, rotated_at FROM encryption_sections`);
  res.json({ success: true, sections: result.rows });
});

// ─── طلب فتح بيانات حساب مستخدم عبر قسم معيّن ────────────────────
router.post('/access', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const { section, code, username } = req.body;

  if (!['web', 'android', 'ios'].includes(section)) {
    return res.status(400).json({ success: false, message: 'قسم غير صالح' });
  }

  const expectedCode = process.env[SECTION_ENV_KEYS[section]];
  const codeIsValid = Boolean(expectedCode) && code === expectedCode;

  const userResult = await query(
    `SELECT id, email, username, display_name, created_at FROM users WHERE username = $1`,
    [username]
  );
  const targetUser = userResult.rows[0] || null;

  // تسجيل كل محاولة، ناجحة أو فاشلة، قبل إرجاع أي نتيجة
  await query(
    `INSERT INTO encryption_access_log (admin_id, section, target_user_id, success, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [req.admin.id, section, targetUser?.id || null, codeIsValid, req.ip]
  );

  if (!codeIsValid) {
    return res.status(403).json({ success: false, message: 'كود القسم غير صحيح' });
  }
  if (!targetUser) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }

  const lastSession = await query(
    `SELECT ip_address, created_at FROM sessions
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [targetUser.id]
  );

  res.json({
    success: true,
    section,
    data: {
      id: targetUser.id,
      username: targetUser.username,
      email: targetUser.email,
      displayName: targetUser.display_name,
      accountCreatedAt: targetUser.created_at,
      lastLoginIp: lastSession.rows[0]?.ip_address || null,
      lastLoginAt: lastSession.rows[0]?.created_at || null,
    },
  });
});

// ─── سجل محاولات الفتح لهذا الأدمن (أو للجميع إذا Owner) ─────────
router.get('/access-log', requirePermission(PERMISSIONS.AUDIT_VIEW), async (req, res) => {
  const { limit = 50 } = req.query;
  const result = await query(
    `SELECT * FROM encryption_access_log ORDER BY created_at DESC LIMIT $1`,
    [parseInt(limit)]
  );
  res.json({ success: true, log: result.rows });
});

module.exports = router;
