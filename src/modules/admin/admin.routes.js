// ═══════════════════════════════════════════════════════════════
// AR App — Admin Routes (Master Key، مراجعة المحتوى، السبام،
// الكلمات المحظورة، الأحداث الأمنية، الإحصائيات، IPs الموثوقة)
//
// ⚠️ تعديل جوهري: هذا الملف كان يستعمل requireAdmin (نظام قديم
// يتحقق من users.is_admin بتوكن مستخدم عادي) — غير متوافق أبداً مع
// توكن الأدمن الجديد (adminId) الصادر من نظام RBAC. تحوّل بالكامل
// لـ adminAuthenticate + requirePermission، متوافق الآن مع أي أدمن
// دخل عبر /api/admin/auth/login.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { adminLimiter } = require('../../middleware/rateLimit');
const { query } = require('../../config/database');
const { getCache, setCache, deleteCache } = require('../../config/redis');
const { logAdminAction } = require('../../utils/auditLog');
const securityClient = require('../ai-filter/security.client');

const router = express.Router();
router.use(adminLimiter);
router.use(adminAuthenticate);

// ═══════════════════════════════════════════════════════════════
// MASTER KEY — قفل/فتح التشفير (حساس جداً، Owner افتراضياً)
// ═══════════════════════════════════════════════════════════════

router.post('/master/unlock', requirePermission(PERMISSIONS.MASTER_KEY_UNLOCK), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: 'كلمة المرور مطلوبة' });

    const result = await securityClient.unlockMasterKey(password);

    if (result.success) {
      await query(
        `INSERT INTO security_events (user_id, event_type, severity, details)
         VALUES ($1, 'master_key_unlocked', 'critical', $2)`,
        [req.admin.user_id, JSON.stringify({ adminId: req.admin.id, ip: req.ip })]
      );
      await logAdminAction({ adminId: req.admin.id, action: 'master_key.unlock', req });
      res.json({ success: true, message: 'تم فتح Master Key — كل البيانات متاحة' });
    } else {
      res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }
  } catch (err) {
    if (err.response?.status === 401) {
      await query(
        `INSERT INTO security_events (user_id, event_type, severity)
         VALUES ($1, 'master_key_wrong_password', 'critical')`,
        [req.admin.user_id]
      );
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }
    res.status(500).json({ success: false, message: 'خدمة الأمان غير متاحة' });
  }
});

router.post('/master/lock', requirePermission(PERMISSIONS.MASTER_KEY_UNLOCK), async (req, res) => {
  try {
    await securityClient.lockMasterKey();
    await query(
      `INSERT INTO security_events (user_id, event_type, severity)
       VALUES ($1, 'master_key_locked', 'info')`,
      [req.admin.user_id]
    );
    await logAdminAction({ adminId: req.admin.id, action: 'master_key.lock', req });
    res.json({ success: true, message: 'تم قفل Master Key' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في القفل' });
  }
});

router.get('/master/status', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  try {
    const status = await securityClient.getSecurityStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.json({ success: true, data: { status: 'error', unlocked: false } });
  }
});

// ═══════════════════════════════════════════════════════════════
// CONTENT MODERATION — مراجعة المحتوى
// ═══════════════════════════════════════════════════════════════

router.get('/content-checks', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    const action = req.query.action || 'review';
    const limit = parseInt(req.query.limit) || 20;
    const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

    const result = await query(
      `SELECT cc.*, u.username, u.display_name,
       p.content AS post_content
       FROM content_checks cc
       LEFT JOIN users u ON cc.user_id = u.id
       LEFT JOIN posts p ON cc.content_id = p.id
       WHERE cc.action = $1
       ORDER BY cc.created_at DESC
       LIMIT $2 OFFSET $3`,
      [action, limit, offset]
    );

    const total = await query('SELECT COUNT(*) FROM content_checks WHERE action = $1', [action]);

    res.json({ success: true, data: result.rows, total: parseInt(total.rows[0].count) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المراجعات' });
  }
});

router.put('/content-checks/:id/approve', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    await query(
      `UPDATE content_checks SET action = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
      [req.admin.user_id, req.params.id]
    );
    await logAdminAction({ adminId: req.admin.id, action: 'content_check.approve', targetType: 'content_check', targetId: req.params.id, req });
    res.json({ success: true, message: 'تم قبول المحتوى' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

router.put('/content-checks/:id/reject', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    const check = await query('SELECT * FROM content_checks WHERE id = $1', [req.params.id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });

    const { content_type, content_id } = check.rows[0];
    if (content_type === 'post' && content_id) {
      await query('UPDATE posts SET is_deleted=TRUE WHERE id=$1', [content_id]);
    }

    await query(
      `UPDATE content_checks SET action = 'rejected', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
      [req.admin.user_id, req.params.id]
    );
    await logAdminAction({ adminId: req.admin.id, action: 'content_check.reject', targetType: 'content_check', targetId: req.params.id, req });
    res.json({ success: true, message: 'تم رفض وحذف المحتوى' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SPAM MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get('/spam-scores', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    const result = await query(
      `SELECT ss.*, u.username, u.display_name, u.is_banned
       FROM spam_scores ss JOIN users u ON ss.user_id = u.id
       WHERE ss.score > 20 ORDER BY ss.score DESC LIMIT 50`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

router.put('/spam-scores/:userId/reset', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    await query(`UPDATE spam_scores SET score=0, posts_today=0, auto_banned=FALSE WHERE user_id=$1`, [req.params.userId]);
    await query('UPDATE users SET is_banned=FALSE, ban_reason=NULL WHERE id=$1', [req.params.userId]);
    await logAdminAction({ adminId: req.admin.id, action: 'spam_score.reset', targetType: 'user', targetId: req.params.userId, req });
    res.json({ success: true, message: 'تم إعادة تصفير نقاط السبام' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

// ═══════════════════════════════════════════════════════════════
// BLOCKED WORDS
// ═══════════════════════════════════════════════════════════════

router.get('/blocked-words', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    const result = await query('SELECT * FROM blocked_words ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

router.post('/blocked-words', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    const { word, severity = 'warn' } = req.body;
    if (!word) return res.status(400).json({ success: false, message: 'الكلمة مطلوبة' });

    await query(
      `INSERT INTO blocked_words (word, severity, added_by) VALUES ($1, $2, $3)
       ON CONFLICT (word) DO UPDATE SET severity=$2`,
      [word.toLowerCase(), severity, req.admin.user_id]
    );
    await logAdminAction({ adminId: req.admin.id, action: 'blocked_word.add', afterData: { word, severity }, req });
    res.json({ success: true, message: `تمت إضافة "${word}" للكلمات المحظورة` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

router.delete('/blocked-words/:id', requirePermission(PERMISSIONS.CONTENT_MODERATE), async (req, res) => {
  try {
    await query('DELETE FROM blocked_words WHERE id=$1', [req.params.id]);
    await logAdminAction({ adminId: req.admin.id, action: 'blocked_word.delete', targetType: 'blocked_word', targetId: req.params.id, req });
    res.json({ success: true, message: 'تم حذف الكلمة' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECURITY EVENTS
// ═══════════════════════════════════════════════════════════════

router.get('/security-events', requirePermission(PERMISSIONS.SECURITY_EVENTS_VIEW), async (req, res) => {
  try {
    const severity = req.query.severity;
    const search = req.query.search;
    const limit = parseInt(req.query.limit) || 25;
    const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

    const result = await query(
      `SELECT se.*, u.username AS related_username
       FROM security_events se
       LEFT JOIN users u ON se.user_id = u.id
       WHERE ($1::text IS NULL OR se.severity = $1)
         AND ($2::text IS NULL OR se.event_type ILIKE '%' || $2 || '%' OR u.username ILIKE '%' || $2 || '%')
       ORDER BY se.created_at DESC
       LIMIT $3 OFFSET $4`,
      [severity || null, search || null, limit + 1, offset]
    );

    const hasMore = result.rows.length > limit;
    res.json({
      success: true,
      data: result.rows.slice(0, limit).map((r) => ({
        eventType: r.event_type, severity: r.severity, ipAddress: r.details?.ip || null,
        relatedUsername: r.related_username, createdAt: r.created_at,
      })),
      page: parseInt(req.query.page) || 1,
      hasMore,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ' });
  }
});

// ═══════════════════════════════════════════════════════════════
// STATS — إحصائيات لوحة القيادة الرئيسية
// ═══════════════════════════════════════════════════════════════

router.get('/stats', requirePermission(PERMISSIONS.STATS_VIEW), async (req, res) => {
  try {
    const cached = await getCache('admin:stats:full');
    if (cached) return res.json({ success: true, data: cached });

    const [
      totalUsers, postsToday, activeCommunities, pendingReports,
      vpnBlockedToday, masterStatus, recentActivity,
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query(`SELECT COUNT(*) FROM posts WHERE is_deleted=FALSE AND created_at > NOW() - INTERVAL '24 hours'`),
      query(`SELECT COUNT(*) FROM communities`),
      query(`SELECT COUNT(*) FROM reports WHERE status='pending'`),
      query(`SELECT COUNT(*) FROM vpn_logs WHERE blocked_at > NOW() - INTERVAL '24 hours'`),
      securityClient.getSecurityStatus().catch(() => ({ unlocked: false })),
      query(`
        (SELECT 'new_registration' AS type, username AS summary, created_at FROM users ORDER BY created_at DESC LIMIT 5)
        UNION ALL
        (SELECT 'content_reported' AS type, reason AS summary, created_at FROM reports ORDER BY created_at DESC LIMIT 5)
        UNION ALL
        (SELECT 'vpn_blocked' AS type, ip_address::text AS summary, blocked_at AS created_at FROM vpn_logs ORDER BY blocked_at DESC LIMIT 5)
        ORDER BY created_at DESC LIMIT 15
      `),
    ]);

    // فحص حالة قاعدة البيانات وRedis مباشرة (بدّلنا فكرة "Go/Rust"
    // القديمة — تلك الخدمات دُمجت بعملية Node واحدة، ماعادوش موجودين)
    let dbOk = true;
    try { await query('SELECT 1'); } catch { dbOk = false; }
    let redisOk = true;
    try { await getCache('__healthcheck__'); } catch { redisOk = false; }

    const stats = {
      totalUsers: { value: parseInt(totalUsers.rows[0].count) },
      postsToday: { value: parseInt(postsToday.rows[0].count) },
      activeNow: { value: 0 }, // ⚠️ يحتاج تتبّع مستخدمين متصلين حياً عبر WebSocket — غير مبني بعد
      pendingReports: { value: parseInt(pendingReports.rows[0].count) },
      vpnBlockedToday: { value: parseInt(vpnBlockedToday.rows[0].count) },
      activeCommunities: { value: parseInt(activeCommunities.rows[0].count) },
      services: {
        database: { status: dbOk ? 'ok' : 'down', checkedAt: new Date().toISOString() },
        redis: { status: redisOk ? 'ok' : 'down', checkedAt: new Date().toISOString() },
      },
      masterKeyUnlocked: masterStatus.unlocked || false,
      recentActivity: recentActivity.rows,
    };

    await setCache('admin:stats:full', stats, 30);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في الإحصائيات' });
  }
});

// ═══════════════════════════════════════════════════════════════
// TRUSTED IPs
// ═══════════════════════════════════════════════════════════════

router.get('/trusted-ips', requirePermission(PERMISSIONS.TRUSTED_IPS_MANAGE), async (req, res) => {
  const result = await query('SELECT * FROM trusted_ips ORDER BY created_at DESC');
  res.json({ success: true, data: result.rows });
});

router.post('/trusted-ips', requirePermission(PERMISSIONS.TRUSTED_IPS_MANAGE), async (req, res) => {
  const { ip, label } = req.body;
  if (!ip) return res.status(400).json({ success: false, message: 'IP مطلوب' });
  await query(
    'INSERT INTO trusted_ips (ip_address, label, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [ip, label, req.admin.user_id]
  );
  await logAdminAction({ adminId: req.admin.id, action: 'trusted_ip.add', afterData: { ip, label }, req });
  res.json({ success: true, message: `تمت إضافة ${ip} للـ Whitelist` });
});

module.exports = router;
