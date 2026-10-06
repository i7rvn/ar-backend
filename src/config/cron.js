const { query } = require('../config/database');
const logger = require('./logger');
const { resetDailySpamScores } = require('../modules/ai-filter/spam');
const { rotateExpiredKeys } = require('../modules/ai-filter/encryption.service');
const { cleanupExpiredStories } = require('../modules/stories/stories.service');

async function cleanupExpiredOTPs() {
 try {
 const r = await query(`DELETE FROM otp_codes WHERE expires_at < NOW()`);
 if (r.rowCount > 0) logger.info(`حذف ${r.rowCount} OTP منتهي`);
 } catch (err) { logger.error('خطأ:', err); }
}

async function cleanupExpiredSessions() {
 try {
 const r = await query(`DELETE FROM sessions WHERE expires_at < NOW()`);
 if (r.rowCount > 0) logger.info(`حذف ${r.rowCount} جلسة منتهية`);
 } catch (err) { logger.error('خطأ:', err); }
}

async function cleanupExpiredMessages() {
 try {
 const r = await query(
 `UPDATE messages SET is_deleted=TRUE, encrypted_content='[رسالة محذوفة]'
 WHERE expires_at < NOW() AND is_deleted=FALSE`
 );
 if (r.rowCount > 0) logger.info(`حذف ${r.rowCount} رسالة منتهية`);
 } catch (err) { logger.error('خطأ:', err); }
}

async function cleanupOldVPNLogs() {
 try {
 await query(`DELETE FROM vpn_logs WHERE blocked_at < NOW() - INTERVAL '30 days'`);
 } catch (err) { logger.error('خطأ:', err); }
}

async function cleanupOldSecurityLogs() {
 try {
 await query(
 `DELETE FROM security_logs WHERE created_at < NOW() - INTERVAL '90 days' AND severity='info'`
 );
 await query(
 `DELETE FROM security_events WHERE created_at < NOW() - INTERVAL '90 days' AND severity='info'`
 );
 } catch (err) { logger.error('خطأ:', err); }
}

async function cleanupExpiredStoriesJob() {
 try {
  const removed = await cleanupExpiredStories();
  if (removed > 0) logger.info(`حذف ${removed} قصة منتهية`);
 } catch (err) { logger.error('خطأ:', err); }
}

// ─── جديد المرحلة 4 ───────────────────────────────────────────
async function cleanupOldContentChecks() {
 try {
 const r = await query(
 `DELETE FROM content_checks
 WHERE action='approved' AND created_at < NOW() - INTERVAL '7 days'`
 );
 if (r.rowCount > 0) logger.info(`حذف ${r.rowCount} فحص محتوى قديم`);
 } catch (err) { logger.error('خطأ:', err); }
}

function startCronJobs() {
 // كل 5 دقائق
 setInterval(cleanupExpiredMessages, 5 * 60 * 1000);
 setInterval(cleanupExpiredStoriesJob, 5 * 60 * 1000);

 // كل 30 دقيقة
 setInterval(cleanupExpiredOTPs, 30 * 60 * 1000);

 // كل ساعة
 setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

 // كل يوم (3 الصبح)
 setInterval(cleanupOldVPNLogs, 24 * 60 * 60 * 1000);
 setInterval(resetDailySpamScores, 24 * 60 * 60 * 1000);
 setInterval(cleanupOldContentChecks, 24 * 60 * 60 * 1000);

 // كل أسبوع
 setInterval(cleanupOldSecurityLogs, 7 * 24 * 60 * 60 * 1000);

 // كل يوم: تدوير المفاتيح المنتهية
 setInterval(rotateExpiredKeys, 24 * 60 * 60 * 1000);

 // تشغيل فوري
 cleanupExpiredOTPs();
 cleanupExpiredSessions();
 cleanupExpiredMessages();
 cleanupExpiredStoriesJob();
 resetDailySpamScores();

 logger.info('المهام التلقائية تعمل');
}

module.exports = { startCronJobs };
