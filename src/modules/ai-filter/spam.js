// ═══════════════════════════════════════════════════════════════
// AR App — نظام كشف السبام التلقائي
// ═══════════════════════════════════════════════════════════════

const { query, withTransaction } = require('../../config/database');
const logger = require('../../config/logger');

const SPAM_THRESHOLDS = {
 AUTO_BAN: 80, // حظر تلقائي
 REVIEW: 50, // مراجعة يدوية
 WARN: 30, // تحذير
};

// ─── حساب نقاط السبام ─────────────────────────────────────────
async function calculateSpamScore(userId, postContent) {
 return await withTransaction(async (client) => {
 // جلب أو إنشاء سجل السبام
 let spamRecord = await client.query(
 `SELECT * FROM spam_scores WHERE user_id = $1`, [userId]
 );

 if (!spamRecord.rows.length) {
 await client.query(
 `INSERT INTO spam_scores (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]
 );
 spamRecord = await client.query(
 `SELECT * FROM spam_scores WHERE user_id = $1`, [userId]
 );
 }

 const record = spamRecord.rows[0];
 let score = record.score || 0;

 // ─── قواعد كشف السبام ─────────────────────────────────────

 // 1. حساب جديد (أقل من 24 ساعة) + نشاط مفرط
 const userAge = await client.query(
 `SELECT EXTRACT(EPOCH FROM (NOW() - created_at))/3600 AS hours FROM users WHERE id=$1`,
 [userId]
 );
 const accountHours = parseFloat(userAge.rows[0]?.hours || 999);
 if (accountHours < 24 && record.posts_today > 10) score += 30;

 // 2. منشورات كثيرة في وقت قصير
 const recentPosts = await client.query(
 `SELECT COUNT(*) FROM posts
 WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 hour'`,
 [userId]
 );
 const postCount = parseInt(recentPosts.rows[0].count);
 if (postCount > 20) score += 40;
 else if (postCount > 10) score += 20;

 // 3. نفس المحتوى يتكرر
 const duplicate = await client.query(
 `SELECT COUNT(*) FROM posts
 WHERE user_id=$1 AND content=$2 AND created_at > NOW() - INTERVAL '24 hours'`,
 [userId, postContent]
 );
 if (parseInt(duplicate.rows[0].count) > 0) score += 50;

 // 4. بلاغات كثيرة على المستخدم
 const reports = await client.query(
 `SELECT COUNT(*) FROM reports WHERE reported_user_id=$1 AND status='pending'`,
 [userId]
 );
 const reportCount = parseInt(reports.rows[0].count);
 if (reportCount > 5) score += 30;
 if (reportCount > 10) score += 20;

 // 5. كلمات سبام في المحتوى
 const spamWords = await client.query(
 `SELECT COUNT(*) FROM blocked_words
 WHERE $1 ILIKE '%' || word || '%' AND severity IN ('warn','reject')`,
 [postContent]
 );
 if (parseInt(spamWords.rows[0].count) > 0) score += 20;

 // تحديث السجل
 await client.query(
 `UPDATE spam_scores
 SET score = $1, posts_today = posts_today + 1, updated_at = NOW()
 WHERE user_id = $2`,
 [Math.min(score, 100), userId]
 );

 // ─── القرار ────────────────────────────────────────────────
 let action = 'approved';

 if (score >= SPAM_THRESHOLDS.AUTO_BAN) {
 action = 'banned';
 // حظر تلقائي
 await client.query(
 `UPDATE users SET is_banned=TRUE, ban_reason='حظر تلقائي بسبب السبام' WHERE id=$1`,
 [userId]
 );
 await client.query(
 `UPDATE spam_scores SET auto_banned=TRUE WHERE user_id=$1`, [userId]
 );
 // سجل أمان
 await client.query(
 `INSERT INTO security_events (user_id, event_type, severity, details)
 VALUES ($1, 'auto_spam_ban', 'critical', $2)`,
 [userId, JSON.stringify({ score, posts_today: record.posts_today + 1 })]
 );
 logger.warn(`حظر تلقائي للمستخدم ${userId} (نقاط سبام: ${score})`);

 } else if (score >= SPAM_THRESHOLDS.REVIEW) {
 action = 'review';
 } else if (score >= SPAM_THRESHOLDS.WARN) {
 action = 'warn';
 }

 return { action, score };
 });
}

// ─── إعادة تصفير نقاط السبام يومياً ─────────────────────────
async function resetDailySpamScores() {
 try {
 const r = await query(
 `UPDATE spam_scores
 SET posts_today = 0, score = GREATEST(score - 10, 0), updated_at = NOW()
 WHERE DATE(updated_at) < CURRENT_DATE AND auto_banned = FALSE`
 );
 if (r.rowCount > 0) logger.info(`تم تصفير نقاط السبام اليومية لـ ${r.rowCount} مستخدم`);
 } catch (err) {
 logger.error('خطأ في تصفير السبام:', err);
 }
}

module.exports = { calculateSpamScore, resetDailySpamScores, SPAM_THRESHOLDS };
