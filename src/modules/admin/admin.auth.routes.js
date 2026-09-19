// ═══════════════════════════════════════════════════════════════
// AR App — Admin Auth (دخول أدمن بخطوتين: كلمة سر → 2FA إجباري)
//
// تصميم بخطوتين (تمّ اختياره بدل الطلب الواحد القديم) باش الواجهة
// ما تعاودش تبعث كلمة السر بخطوة الـ 2FA — بس tempToken قصير العمر.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { query } = require('../../config/database');
const { verifyPassword } = require('../auth/password.service');
const { verifyTOTPLogin } = require('../twofa/twofa.service');
const { checkAccountLock, recordFailedAttempt, clearFailedAttempts } = require('../../middleware/accountLock');
const { blacklistToken, isTokenBlacklisted, client: redisClient } = require('../../config/redis');
const { sendAlert } = require('../../config/telegram');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { getAdminPermissions } = require('../../middleware/requirePermission');
const logger = require('../../config/logger');

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

// حد صارم خاص بدخول الأدمن — أشد المسارات حساسية بالنظام كامل،
// بالإضافة إلى القفل التدريجي (accountLock) — طبقتا دفاع منفصلتان
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'محاولات دخول كثيرة، انتظر 15 دقيقة.', code: 'ADMIN_LOGIN_RATE_LIMIT' },
});

async function loadAdminProfile(adminId) {
  const result = await query(
    `SELECT a.id, a.is_owner, a.role_id, u.username, u.display_name, u.avatar_url, r.name AS role_name
     FROM admins a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN roles r ON r.id = a.role_id
     WHERE a.id = $1`,
    [adminId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  const platformsResult = await query(
    `SELECT platform FROM admin_platform_access WHERE admin_id = $1`,
    [adminId]
  );

  const permissions = row.is_owner ? ['*'] : await getAdminPermissions(adminId);

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role_name,
    isOwner: row.is_owner,
    permissions,
    platforms: platformsResult.rows.map((p) => p.platform),
  };
}

// ─── خطوة 1: التحقق من اسم المستخدم/البريد + كلمة السر ──────────
router.post('/login', adminLoginLimiter, checkAccountLock, async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  // نحقن identifier بجسم الطلب باش checkAccountLock يقفل حسب الحساب
  // المستهدف نفسه، ماشي حسب IP فقط (كان يعتمد على IP فقط سابقاً)
  const lockKey = `lock:admin:${identifier}`;

  const result = await query(
    `SELECT a.id AS admin_id, a.is_owner, a.totp_required, u.id AS user_id, u.password_hash, u.is_banned
     FROM admins a JOIN users u ON u.id = a.user_id
     WHERE u.email = $1 OR u.username = $1`,
    [identifier]
  );

  const row = result.rows[0];
  const passwordOk = row && (await verifyPassword(row.password_hash, password));

  if (!row || !passwordOk || row.is_banned) {
    await recordFailedAttempt(lockKey);
    // رسالة عامة عمداً — لا نكشف هل الحساب موجود أم لا
    return res.status(401).json({ success: false, message: 'بيانات دخول خاطئة', code: 'INVALID_CREDENTIALS' });
  }

  await clearFailedAttempts(lockKey);

  // totp_required = TRUE إجبارياً لكل الأدمنز بالتصميم — أي أدمن
  // بلا 2FA مفعّل هو خطأ إعداد، ماشي حالة عادية نتعامل معها هنا
  if (!row.totp_required) {
    logger.warn(`أدمن بلا 2FA حاول الدخول: ${identifier}`);
    return res.status(500).json({ success: false, message: 'حساب هذا الأدمن غير مُعَدّ بشكل صحيح — تواصل مع المالك' });
  }

  const tempToken = jwt.sign(
    { adminId: row.admin_id, type: 'admin_temp' },
    ADMIN_SECRET,
    { expiresIn: '5m' }
  );

  res.json({ success: true, data: { tempToken } });
});

// ─── خطوة 2: كود 2FA — يصدر التوكنات الحقيقية ────────────────────
router.post('/verify-totp', adminLoginLimiter, async (req, res) => {
  const { tempToken, code } = req.body;
  if (!tempToken || !code) {
    return res.status(400).json({ success: false, message: 'الكود مطلوب' });
  }

  let decoded;
  try {
    decoded = jwt.verify(tempToken, ADMIN_SECRET);
    if (decoded.type !== 'admin_temp') throw new Error('نوع توكن خاطئ');
  } catch {
    return res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة المؤقتة، سجّل الدخول من جديد', code: 'TEMP_TOKEN_EXPIRED' });
  }

  const lockKey = `lock:admin_totp:${decoded.adminId}`;
  const attempts = parseInt(await redisClient.get(lockKey)) || 0;
  if (attempts >= 5) {
    const ttl = await redisClient.ttl(lockKey);
    return res.status(423).json({ success: false, message: `محاولات كثيرة، انتظر ${Math.ceil(ttl / 60)} دقيقة`, code: 'ACCOUNT_LOCKED', retryAfterSeconds: ttl });
  }

  const adminResult = await query(`SELECT user_id FROM admins WHERE id = $1`, [decoded.adminId]);
  if (adminResult.rows.length === 0) {
    return res.status(401).json({ success: false, message: 'حساب الأدمن غير موجود' });
  }

  const totpValid = await verifyTOTPLogin(adminResult.rows[0].user_id, code);
  if (!totpValid) {
    await recordFailedAttempt(lockKey);
    return res.status(401).json({ success: false, message: 'الكود غير صحيح', code: 'INVALID_2FA' });
  }
  await clearFailedAttempts(lockKey);

  // token_version الحالي للأدمن — يُضمَّن بالتوكن باش نقدر نبطّل كل
  // جلساته دفعة وحدة لاحقاً (مثلاً لو الأدمن تحوّل لعدو داخلي، أو
  // اشتبهنا بتسريب) بلا انتظار انتهاء الصلاحية الطبيعية (8 ساعات)
  const tvResult = await query(`SELECT token_version FROM admins WHERE id = $1`, [decoded.adminId]);
  const tokenVersion = tvResult.rows[0]?.token_version || 0;

  const accessToken = jwt.sign(
    { adminId: decoded.adminId, tv: tokenVersion, jti: crypto.randomUUID() },
    ADMIN_SECRET,
    { expiresIn: '8h' }
  );
  const refreshToken = jwt.sign(
    { adminId: decoded.adminId, tv: tokenVersion, type: 'admin_refresh', jti: crypto.randomUUID() },
    process.env.ADMIN_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET,
    { expiresIn: '3d' }
  );

  const profile = await loadAdminProfile(decoded.adminId);

  await query(
    `INSERT INTO audit_logs (admin_id, action, ip_address, user_agent)
     VALUES ($1, 'admin_login', $2, $3)`,
    [decoded.adminId, req.ip, req.headers['user-agent'] || null]
  ).catch((err) => logger.error('فشل تسجيل audit_logs لدخول أدمن:', err));

  await sendAlert(`دخول أدمن جديد: ${profile.username}`, 'info');

  res.json({ success: true, data: { accessToken, refreshToken, admin: profile } });
});

// ─── تجديد التوكن ──────────────────────────────────────────────
// تحقق كامل + rotation إجباري: قبل هذا التعديل، /logout كان يبلاكليست
// الـ accessToken فقط — الـ refreshToken يبقى صالح 3 أيام كاملة حتى
// بعد الخروج اليدوي. توا: بلاكليست + تحقق is_banned/token_version +
// إبطال فوري للـ refresh token القديم بعد كل استعمال.
router.post('/refresh-token', adminLoginLimiter, async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ success: false, message: 'refreshToken مطلوب' });

  try {
    const decoded = jwt.verify(refreshToken, process.env.ADMIN_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET);
    if (decoded.type !== 'admin_refresh') throw new Error('نوع توكن خاطئ');

    if (await isTokenBlacklisted(refreshToken)) {
      return res.status(401).json({ success: false, message: 'رمز التجديد مُبطَل، سجل دخولك مجدداً', code: 'REFRESH_REVOKED' });
    }

    const adminResult = await query(
      `SELECT a.token_version, u.is_banned
       FROM admins a JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [decoded.adminId]
    );
    const admin = adminResult.rows[0];
    if (!admin) {
      return res.status(401).json({ success: false, message: 'حساب الأدمن غير موجود', code: 'ADMIN_NOT_FOUND' });
    }
    if (admin.is_banned) {
      return res.status(403).json({ success: false, message: 'حساب الأدمن موقوف', code: 'ADMIN_BANNED' });
    }
    if ((decoded.tv || 0) !== (admin.token_version || 0)) {
      return res.status(401).json({ success: false, message: 'انتهت الجلسة، سجل دخولك مجدداً', code: 'TOKEN_VERSION_MISMATCH' });
    }

    // rotation: نبطّل الـ refresh token القديم فوراً بعد إصدار الجديد
    const remaining = decoded.exp ? Math.max(decoded.exp - Math.floor(Date.now() / 1000), 60) : 3 * 24 * 3600;
    await blacklistToken(refreshToken, remaining);

    const accessToken = jwt.sign(
      { adminId: decoded.adminId, tv: admin.token_version || 0, jti: crypto.randomUUID() },
      ADMIN_SECRET,
      { expiresIn: '8h' }
    );
    const newRefreshToken = jwt.sign(
      { adminId: decoded.adminId, tv: admin.token_version || 0, type: 'admin_refresh', jti: crypto.randomUUID() },
      process.env.ADMIN_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET,
      { expiresIn: '3d' }
    );

    res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    if (err.status) throw err;
    res.status(401).json({ success: false, message: 'انتهت الجلسة', code: 'INVALID_REFRESH' });
  }
});

// ─── خروج ──────────────────────────────────────────────────────
// refreshToken اختياري بالـ body — لو انبعث يتبلاكليست معاه (كان
// ناقص سابقاً، وهذا كان يلغي معنى "تسجيل الخروج" لأخطر حساب بالنظام)
router.post('/logout', adminAuthenticate, async (req, res) => {
  try {
    const decoded = jwt.decode(req.adminToken);
    const expiresIn = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
    if (expiresIn > 0) await blacklistToken(req.adminToken, expiresIn);

    const { refreshToken } = req.body || {};
    if (refreshToken) {
      const rDecoded = jwt.decode(refreshToken);
      const rRemaining = rDecoded?.exp ? Math.max(rDecoded.exp - Math.floor(Date.now() / 1000), 60) : 3 * 24 * 3600;
      await blacklistToken(refreshToken, rRemaining);
    }
  } catch (e) {
    logger.error('خطأ أثناء بلاكليست توكنات الأدمن عند logout:', e);
  }
  res.json({ success: true, message: 'تم الخروج' });
});

// ─── ملف الأدمن الحالي (يُستعمل عند فتح الداشبورد مباشرة بتوكن محفوظ) ──
router.get('/me', adminAuthenticate, async (req, res) => {
  const profile = await loadAdminProfile(req.admin.id);
  if (!profile) return res.status(404).json({ success: false, message: 'غير موجود' });
  res.json({ success: true, data: profile });
});

module.exports = router;
