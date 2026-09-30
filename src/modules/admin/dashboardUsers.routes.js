// ═══════════════════════════════════════════════════════════════
// AR App — Admin: إدارة المستخدمين
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { adminLimiter } = require('../../middleware/rateLimit');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { logAdminAction } = require('../../utils/auditLog');
const { getActivityHistory } = require('../users/activityHistory.service');
const { blacklistToken } = require('../../config/redis');

const router = express.Router();
router.use(adminLimiter);
router.use(adminAuthenticate);

// ─── قائمة المستخدمين — بحث + فلترة + صفحات ──────────────────────
router.get('/', requirePermission(PERMISSIONS.USERS_VIEW), async (req, res) => {
  const { search, status, page = 1, limit = 20 } = req.query;
  const lim = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(username ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
  }
  if (status === 'active') conditions.push('is_banned = FALSE');
  if (status === 'banned') conditions.push('is_banned = TRUE');

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT id, username, display_name, avatar_url, is_verified, is_banned, posts_count, created_at
     FROM users ${whereClause}
     ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, lim + 1, offset]
  );

  const hasMore = result.rows.length > lim;
  res.json({
    success: true,
    data: result.rows.slice(0, lim).map((u) => ({
      id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url,
      isVerified: u.is_verified, isBanned: u.is_banned, postsCount: u.posts_count, createdAt: u.created_at,
    })),
    page: parseInt(page) || 1,
    hasMore,
  });
});

// ─── تفاصيل مستخدم — بروفايل + جلسات + بلاغات ضده + آخر نشاط ─────
router.get('/:id', requirePermission(PERMISSIONS.USERS_VIEW), async (req, res) => {
  const userResult = await query(
    `SELECT id, username, display_name, avatar_url, bio, is_verified, is_banned, ban_reason,
            posts_count, followers_count, following_count, created_at
     FROM users WHERE id = $1`,
    [req.params.id]
  );
  if (!userResult.rows.length) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  const u = userResult.rows[0];

  const [sessions, reports, activity] = await Promise.all([
    query(
      `SELECT device_name AS device_info, ip_address, last_seen_at AS created_at
       FROM sessions_devices WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 10`,
      [u.id]
    ),
    query(
      `SELECT reason, created_at FROM reports WHERE reported_user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [u.id]
    ),
    getActivityHistory(u.id, 20),
  ]);

  res.json({
    success: true,
    data: {
      id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url, bio: u.bio,
      isVerified: u.is_verified, isBanned: u.is_banned, banReason: u.ban_reason,
      postsCount: u.posts_count, followersCount: u.followers_count, followingCount: u.following_count,
      createdAt: u.created_at,
      sessions: sessions.rows,
      reports: reports.rows,
      activityHistory: activity,
    },
  });
});

// ─── حظر ───────────────────────────────────────────────────────
router.put('/:id/ban', requirePermission(PERMISSIONS.USERS_BAN), async (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, message: 'سبب الحظر مطلوب' });

  const before = await query('SELECT is_banned, ban_reason FROM users WHERE id = $1', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });

  // token_version+1 بالإضافة لـ is_banned=TRUE: مو ضروري وحدو (فحص
  // is_banned موجود أصلاً بـ authenticate()/refreshAccessToken)، لكنه
  // طبقة دفاع إضافية رخيصة تقفل حتى أي احتمال تسرّب مستقبلي بمنطق فحص
  // is_banned بمكان جديد ينسى المطوّر يضيفه
  await query('UPDATE users SET is_banned = TRUE, ban_reason = $1, token_version = token_version + 1 WHERE id = $2', [reason, req.params.id]);

  // إبطال كل جلسات المستخدم النشطة فوراً
  await query('UPDATE sessions SET is_active = FALSE WHERE user_id = $1', [req.params.id]).catch(() => {});

  await logAdminAction({
    adminId: req.admin.id, action: 'user.ban', targetType: 'user', targetId: req.params.id,
    beforeData: before.rows[0], afterData: { isBanned: true, reason }, req,
  });
  res.json({ success: true, message: 'تم حظر الحساب' });
});

// ─── رفع الحظر ─────────────────────────────────────────────────
router.put('/:id/unban', requirePermission(PERMISSIONS.USERS_UNBAN), async (req, res) => {
  const before = await query('SELECT is_banned, ban_reason FROM users WHERE id = $1', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });

  await query('UPDATE users SET is_banned = FALSE, ban_reason = NULL WHERE id = $1', [req.params.id]);
  await logAdminAction({
    adminId: req.admin.id, action: 'user.unban', targetType: 'user', targetId: req.params.id,
    beforeData: before.rows[0], afterData: { isBanned: false }, req,
  });
  res.json({ success: true, message: 'تم رفع الحظر' });
});

// ─── توثيق / إلغاء توثيق ───────────────────────────────────────
router.put('/:id/verify', requirePermission(PERMISSIONS.USERS_VERIFY), async (req, res) => {
  const { verified } = req.body;
  await query('UPDATE users SET is_verified = $1 WHERE id = $2', [Boolean(verified), req.params.id]);
  await logAdminAction({
    adminId: req.admin.id, action: verified ? 'user.verify' : 'user.unverify',
    targetType: 'user', targetId: req.params.id, req,
  });
  res.json({ success: true, message: verified ? 'تم توثيق الحساب' : 'تم إلغاء التوثيق' });
});

// ─── حذف نهائي (بلا فترة سماح — يختلف عن حذف المستخدم لحسابه) ────
router.delete('/:id', requirePermission(PERMISSIONS.USERS_DELETE), async (req, res) => {
  const before = await query('SELECT username, email FROM users WHERE id = $1', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });

  await query('DELETE FROM users WHERE id = $1', [req.params.id]); // CASCADE يحذف الباقي

  await logAdminAction({
    adminId: req.admin.id, action: 'user.delete', targetType: 'user', targetId: req.params.id,
    beforeData: { username: before.rows[0].username }, req,
  });
  res.json({ success: true, message: 'تم حذف الحساب نهائياً' });
});

// ─── دخول كمستخدم (Impersonation) — بلا كلمة سره، بلا إشعار جهاز
// جديد، بلا ظهور بقائمة أجهزته المتصلة (نتفادى device.service.js
// عمداً — راجع ملف التوثيق قسم 7) ────────────────────────────────
router.post('/:id/impersonate', requirePermission(PERMISSIONS.USERS_IMPERSONATE), async (req, res) => {
  const userResult = await query('SELECT id, username, is_banned FROM users WHERE id = $1', [req.params.id]);
  if (!userResult.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });
  const targetUser = userResult.rows[0];
  if (targetUser.is_banned) {
    return res.status(400).json({ success: false, message: 'لا يمكن الدخول لحساب محظور' });
  }

  // token_version الحالي للمستخدم المستهدف — يخليه متسق مع نفس فحص
  // authenticate() العادي (لو تبدّل token_version بعدها، هذا التوكن
  // يتبطّل تلقائياً معاه كباقي جلساته)
  const targetTv = await query('SELECT token_version FROM users WHERE id = $1', [targetUser.id]);

  // توكن دخول عادي (نفس بنية توكن المستخدم العادي)، صلاحية قصيرة
  const accessToken = jwt.sign(
    { userId: targetUser.id, tv: targetTv.rows[0]?.token_version || 0, jti: crypto.randomUUID(), impersonatedBy: req.admin.id },
    process.env.JWT_SECRET,
    { expiresIn: '60m' }
  );

  // يُسجَّل حصراً بسجل تدقيق الأدمن — غير ظاهر للمستخدم المستهدف أبداً
  await logAdminAction({
    adminId: req.admin.id, action: 'user.impersonate', targetType: 'user', targetId: targetUser.id,
    afterData: { targetUsername: targetUser.username }, req,
  });

  // الأمان: ما نبعثوش التوكن الحقيقي بـ query string لأي رابط —
  // توكنات بالـ URL تتسجل بـ logs السيرفر/الـ proxy وتاريخ المتصفح.
  // بدلها: كود عشوائي لمرة وحدة (192-bit)، صالح 30 ثانية فقط، يُبادَل
  // بالتوكن الحقيقي عبر POST منفصل (/api/auth/exchange-impersonation-code)
  const oneTimeCode = crypto.randomBytes(24).toString('hex');
  const { client: redisClient } = require('../../config/redis');
  await redisClient.setEx(`impersonation_code:${oneTimeCode}`, 30, accessToken);

  const frontendUrl = process.env.FRONTEND_URL || '';
  res.json({
    success: true,
    data: {
      frontendUrl,
      entryUrl: `${frontendUrl}/session-entry?code=${oneTimeCode}`,
      expiresInMinutes: 60,
      codeExpiresInSeconds: 30,
    },
  });
});

module.exports = router;
