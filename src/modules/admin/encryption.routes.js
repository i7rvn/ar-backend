// ═══════════════════════════════════════════════════════════════
// AR App — Admin: التشفير والداتا (فتح قسم بكود → جلسة مؤقتة →
// استعلام عن مستخدم → فك تشفير حقيقي)
//
// ⚠️ راجع utils/fieldCrypto.js للتوضيح الكامل: مفاتيح التشفير
// محمّلة دائماً بذاكرة السيرفر (إجباري باش يبعث إيميلات تلقائياً).
// الجلسة هنا تتحكم فقط في مين يقدر "يشوف" القيمة المفكوكة بالداشبورد
// (صلاحية + وقت محدود + تسجيل)، ماشي فك تشفير حقيقي مقفول بلا الكود.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { client: redisClient } = require('../../config/redis');
const { getSetting } = require('../../config/settings');
const { decryptField, SECTIONS } = require('../../utils/fieldCrypto');
const { logAdminAction } = require('../../utils/auditLog');

router.use(adminAuthenticate);

const SECTION_CODE_ENV = { web: 'DECRYPT_CODE_WEB', android: 'DECRYPT_CODE_ANDROID', ios: 'DECRYPT_CODE_IOS' };

function sessionKey(adminId, section) {
  return `enc_session:${adminId}:${section}`;
}

async function logAccess({ adminId, section, success, req }) {
  await query(
    `INSERT INTO encryption_access_log (admin_id, section, success, ip_address)
     VALUES ($1, $2, $3, $4)`,
    [adminId, section, success, req.ip]
  ).catch(() => {}); // ما نوقّفش الطلب لو جدول اللوق فشل، بس ما نخفيش الفحص الأمني بروحه
}

// ─── قائمة الأقسام (بلا كشف أي كود أو حالة حساسة) ────────────────
router.get('/sections', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const unlocked = await Promise.all(
    SECTIONS.map(async (s) => ({ section: s, unlocked: Boolean(await redisClient.get(sessionKey(req.admin.id, s))) }))
  );
  res.json({ success: true, data: unlocked });
});

// ─── فتح قسم — يتحقق من الكود، ينشئ جلسة Redis بمدة TTL ─────────
router.post('/:section/unlock', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const { section } = req.params;
  const { code } = req.body;

  if (!SECTIONS.includes(section)) {
    return res.status(400).json({ success: false, message: 'قسم غير صالح' });
  }
  if (!code) {
    return res.status(400).json({ success: false, message: 'الكود مطلوب' });
  }

  const correctCode = process.env[SECTION_CODE_ENV[section]];
  const isValid = correctCode && crypto.timingSafeEqual(
    Buffer.from(code.padEnd(128, '\0')), Buffer.from(correctCode.padEnd(128, '\0'))
  );

  await logAccess({ adminId: req.admin.id, section, success: Boolean(isValid), req });

  if (!isValid) {
    return res.status(401).json({ success: false, message: 'كود خاطئ' });
  }

  const ttlSeconds = parseInt(await getSetting('encryption_session_ttl_seconds', 600));
  await redisClient.setEx(sessionKey(req.admin.id, section), ttlSeconds, '1');

  await logAdminAction({ adminId: req.admin.id, action: `encryption.${section}.unlock`, req });

  res.json({
    success: true,
    data: { expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() },
  });
});

// ─── قفل يدوي قبل انتهاء المدة ────────────────────────────────
router.post('/:section/lock', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  await redisClient.del(sessionKey(req.admin.id, req.params.section));
  await logAdminAction({ adminId: req.admin.id, action: `encryption.${req.params.section}.lock`, req });
  res.json({ success: true, message: 'تم القفل' });
});

// ─── عرض بيانات مستخدم محمية — يتطلب جلسة قسم صالحة ─────────────
router.get('/:section/users/:userId', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const { section, userId } = req.params;
  if (!SECTIONS.includes(section)) {
    return res.status(400).json({ success: false, message: 'قسم غير صالح' });
  }

  const hasSession = await redisClient.get(sessionKey(req.admin.id, section));
  if (!hasSession) {
    return res.status(401).json({ success: false, message: 'افتح القسم أولاً بالكود', code: 'SECTION_LOCKED' });
  }

  const result = await query(
    `SELECT email_enc, email_iv, email_tag, data_section, created_at,
            (SELECT ip_address FROM sessions_devices sd WHERE sd.user_id = users.id ORDER BY last_seen_at DESC LIMIT 1) AS last_ip
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rows.length) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  const row = result.rows[0];

  if (row.data_section !== section) {
    // بريد هذا المستخدم مشفَّر بقسم آخر — كود هذا القسم لا يفكّه إطلاقاً
    return res.status(403).json({ success: false, message: `بيانات هذا المستخدم تابعة لقسم "${row.data_section}"، ماشي "${section}"` });
  }
  if (!row.email_enc) {
    return res.status(404).json({ success: false, message: 'لا توجد نسخة مشفَّرة لهذا المستخدم بعد (حساب قديم لم يُحوَّل بعد)' });
  }

  let email;
  try {
    email = decryptField({ enc: row.email_enc, iv: row.email_iv, tag: row.email_tag }, section);
  } catch {
    return res.status(500).json({ success: false, message: 'فشل فك التشفير' });
  }

  await logAdminAction({ adminId: req.admin.id, action: `encryption.${section}.view_user`, targetType: 'user', targetId: userId, req });

  res.json({
    success: true,
    data: { email, lastIp: row.last_ip || null, createdAt: row.created_at },
  });
});

// ─── سجل الوصول ────────────────────────────────────────────────
router.get('/access-log', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const result = await query(
    `SELECT eal.*, u.username AS admin_username
     FROM encryption_access_log eal
     LEFT JOIN admins a ON a.id = eal.admin_id
     LEFT JOIN users u ON u.id = a.user_id
     ORDER BY eal.created_at DESC LIMIT $1`,
    [limit]
  );
  res.json({
    success: true,
    data: result.rows.map((r) => ({
      adminUsername: r.admin_username, section: r.section, success: r.success, createdAt: r.created_at,
    })),
  });
});

module.exports = router;
