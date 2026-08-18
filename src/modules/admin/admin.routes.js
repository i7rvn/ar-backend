// ═══════════════════════════════════════════════════════════════
// AR App — Admin Routes (المرحلة 4: أمان كامل)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { requireAdmin } = require('../../middleware/auth');
const { adminLimiter } = require('../../middleware/rateLimit');
const { query } = require('../../config/database');
const { getCache, setCache, deleteCache } = require('../../config/redis');
const securityClient = require('../ai-filter/security.client');

const router = express.Router();
router.use(adminLimiter);
router.use(requireAdmin);

// ═══════════════════════════════════════════════════════════════
// MASTER KEY — قفل/فتح التشفير
// ═══════════════════════════════════════════════════════════════

// فتح Master Key (الأدمن يدخل كلمة السر)
router.post('/master/unlock', async (req, res) => {
 try {
 const { password } = req.body;
 if (!password) return res.status(400).json({ success: false, message: 'كلمة المرور مطلوبة' });

 const result = await securityClient.unlockMasterKey(password);

 if (result.success) {
 // تسجيل الفتح
 await query(
 `INSERT INTO security_events (user_id, event_type, severity, details)
 VALUES ($1, 'master_key_unlocked', 'critical', $2)`,
 [req.user.id, JSON.stringify({ admin: req.user.username, ip: req.ip })]
 );
 res.json({ success: true, message: 'تم فتح Master Key — كل البيانات متاحة' });
 } else {
 res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
 }
 } catch (err) {
 if (err.response?.status === 401) {
 // سجل محاولة فاشلة
 await query(
 `INSERT INTO security_events (user_id, event_type, severity)
 VALUES ($1, 'master_key_wrong_password', 'critical')`,
 [req.user.id]
 );
 return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
 }
 res.status(500).json({ success: false, message: 'خدمة الأمان غير متاحة' });
 }
});

// قفل Master Key
router.post('/master/lock', async (req, res) => {
 try {
 await securityClient.lockMasterKey();
 await query(
 `INSERT INTO security_events (user_id, event_type, severity)
 VALUES ($1, 'master_key_locked', 'info')`,
 [req.user.id]
 );
 res.json({ success: true, message: 'تم قفل Master Key' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ في القفل' });
 }
});

// حالة Master Key
router.get('/master/status', async (req, res) => {
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

// المحتوى تحت المراجعة
router.get('/content-checks', async (req, res) => {
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

 const total = await query(
 'SELECT COUNT(*) FROM content_checks WHERE action = $1', [action]
 );

 res.json({
 success: true,
 data: result.rows,
 total: parseInt(total.rows[0].count),
 });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ في جلب المراجعات' });
 }
});

// قبول محتوى
router.put('/content-checks/:id/approve', async (req, res) => {
 try {
 await query(
 `UPDATE content_checks
 SET action = 'approved', reviewed_by = $1, reviewed_at = NOW()
 WHERE id = $2`,
 [req.user.id, req.params.id]
 );
 res.json({ success: true, message: 'تم قبول المحتوى ' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

// رفض محتوى + حذفه
router.put('/content-checks/:id/reject', async (req, res) => {
 try {
 const check = await query(
 'SELECT * FROM content_checks WHERE id = $1', [req.params.id]
 );
 if (!check.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });

 const { content_type, content_id } = check.rows[0];

 // حذف المحتوى المرفوض
 if (content_type === 'post' && content_id) {
 await query('UPDATE posts SET is_deleted=TRUE WHERE id=$1', [content_id]);
 }

 await query(
 `UPDATE content_checks
 SET action = 'rejected', reviewed_by = $1, reviewed_at = NOW()
 WHERE id = $2`,
 [req.user.id, req.params.id]
 );

 res.json({ success: true, message: 'تم رفض وحذف المحتوى ' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

// ═══════════════════════════════════════════════════════════════
// SPAM MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get('/spam-scores', async (req, res) => {
 try {
 const result = await query(
 `SELECT ss.*, u.username, u.display_name, u.is_banned
 FROM spam_scores ss
 JOIN users u ON ss.user_id = u.id
 WHERE ss.score > 20
 ORDER BY ss.score DESC
 LIMIT 50`
 );
 res.json({ success: true, data: result.rows });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

// إعادة تصفير نقاط مستخدم
router.put('/spam-scores/:userId/reset', async (req, res) => {
 try {
 await query(
 `UPDATE spam_scores SET score=0, posts_today=0, auto_banned=FALSE WHERE user_id=$1`,
 [req.params.userId]
 );
 await query('UPDATE users SET is_banned=FALSE, ban_reason=NULL WHERE id=$1', [req.params.userId]);
 res.json({ success: true, message: 'تم إعادة تصفير نقاط السبام' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

// ═══════════════════════════════════════════════════════════════
// BLOCKED WORDS
// ═══════════════════════════════════════════════════════════════

router.get('/blocked-words', async (req, res) => {
 try {
 const result = await query('SELECT * FROM blocked_words ORDER BY created_at DESC');
 res.json({ success: true, data: result.rows });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

router.post('/blocked-words', async (req, res) => {
 try {
 const { word, severity = 'warn' } = req.body;
 if (!word) return res.status(400).json({ success: false, message: 'الكلمة مطلوبة' });

 await query(
 `INSERT INTO blocked_words (word, severity, added_by) VALUES ($1, $2, $3)
 ON CONFLICT (word) DO UPDATE SET severity=$2`,
 [word.toLowerCase(), severity, req.user.id]
 );
 res.json({ success: true, message: `تمت إضافة "${word}" للكلمات المحظورة` });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

router.delete('/blocked-words/:id', async (req, res) => {
 try {
 await query('DELETE FROM blocked_words WHERE id=$1', [req.params.id]);
 res.json({ success: true, message: 'تم حذف الكلمة' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

// ═══════════════════════════════════════════════════════════════
// SECURITY EVENTS
// ═══════════════════════════════════════════════════════════════

router.get('/security-events', async (req, res) => {
 try {
 const severity = req.query.severity;
 const limit = parseInt(req.query.limit) || 50;

 const result = await query(
 `SELECT se.*, u.username
 FROM security_events se
 LEFT JOIN users u ON se.user_id = u.id
 WHERE ($1::text IS NULL OR se.severity = $1)
 ORDER BY se.created_at DESC
 LIMIT $2`,
 [severity || null, limit]
 );
 res.json({ success: true, data: result.rows });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ' });
 }
});

// ═══════════════════════════════════════════════════════════════
// STATS — إحصائيات شاملة (من المراحل 1-4)
// ═══════════════════════════════════════════════════════════════

router.get('/stats', async (req, res) => {
 try {
 const cached = await getCache('admin:stats:full');
 if (cached) return res.json({ success: true, data: cached });

 const [
 users, posts, messages, vpnBlocked,
 contentRejected, contentReview,
 spamBanned, secEvents,
 masterStatus,
 ] = await Promise.all([
 query('SELECT COUNT(*) FROM users'),
 query('SELECT COUNT(*) FROM posts WHERE is_deleted=FALSE'),
 query('SELECT COUNT(*) FROM messages WHERE is_deleted=FALSE'),
 query(`SELECT COUNT(*) FROM vpn_logs WHERE blocked_at > NOW() - INTERVAL '24 hours'`),
 query(`SELECT COUNT(*) FROM content_checks WHERE action='rejected' AND created_at > NOW() - INTERVAL '24 hours'`),
 query(`SELECT COUNT(*) FROM content_checks WHERE action='review'`),
 query(`SELECT COUNT(*) FROM users WHERE is_banned=TRUE`),
 query(`SELECT COUNT(*) FROM security_events WHERE severity='critical' AND created_at > NOW() - INTERVAL '24 hours'`),
 securityClient.getSecurityStatus(),
 ]);

 const stats = {
 users: parseInt(users.rows[0].count),
 posts: parseInt(posts.rows[0].count),
 messages: parseInt(messages.rows[0].count),
 vpn_blocked_today: parseInt(vpnBlocked.rows[0].count),
 content_rejected_today: parseInt(contentRejected.rows[0].count),
 content_under_review: parseInt(contentReview.rows[0].count),
 banned_users: parseInt(spamBanned.rows[0].count),
 critical_events_today: parseInt(secEvents.rows[0].count),
 master_key_unlocked: masterStatus.unlocked || false,
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

router.get('/trusted-ips', async (req, res) => {
 const result = await query('SELECT * FROM trusted_ips ORDER BY created_at DESC');
 res.json({ success: true, data: result.rows });
});

router.post('/trusted-ips', async (req, res) => {
 const { ip, label } = req.body;
 if (!ip) return res.status(400).json({ success: false, message: 'IP مطلوب' });
 await query(
 'INSERT INTO trusted_ips (ip_address, label, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
 [ip, label, req.user.id]
 );
 res.json({ success: true, message: `تمت إضافة ${ip} للـ Whitelist` });
});

module.exports = router;
