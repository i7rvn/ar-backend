const { query } = require('../../config/database');
const { getSetting } = require('../../config/settings');
const { sendEmail } = require('../../config/email');

// طلب حذف حساب متدرج — يبدأ عد 30 يوم، قابل للإلغاء بمجرد رجوع الدخول
async function requestAccountDeletion(userId) {
 const days = parseInt(await getSetting('account_deletion_days', 30));
 await query(
 `INSERT INTO account_deletion_requests (user_id, scheduled_for)
 VALUES ($1, NOW() + INTERVAL '1 day' * $2)
 ON CONFLICT (user_id) DO UPDATE SET
 requested_at = NOW(), scheduled_for = NOW() + INTERVAL '1 day' * $2, cancelled = FALSE`,
 [userId, days]
 );

 const userResult = await query(`SELECT email FROM users WHERE id = $1`, [userId]);
 if (userResult.rows[0]) {
 await sendEmail(
 userResult.rows[0].email,
 'طلب حذف الحساب',
 `تم استلام طلب حذف حسابك. سيتم الحذف نهائياً بعد ${days} يوم إذا لم تسجّل الدخول مجدداً.\nلإلغاء الطلب، فقط سجّل دخولك.`
 );
 }
}

// تُستدعى تلقائياً عند أي دخول ناجح — تلغي طلب الحذف إذا كان موجود
async function cancelDeletionIfExists(userId) {
 await query(
 `UPDATE account_deletion_requests SET cancelled = TRUE, cancelled_at = NOW()
 WHERE user_id = $1 AND cancelled = FALSE`,
 [userId]
 );
}

// تُستدعى من الـ cron: تحذف نهائياً كل الحسابات لي وصل وقتها
async function processScheduledDeletions() {
 const due = await query(
 `SELECT user_id FROM account_deletion_requests
 WHERE cancelled = FALSE AND scheduled_for <= NOW()`
 );
 for (const row of due.rows) {
 await query(`DELETE FROM users WHERE id = $1`, [row.user_id]); // CASCADE يحذف الباقي
 }
 return due.rows.length;
}

module.exports = { requestAccountDeletion, cancelDeletionIfExists, processScheduledDeletions };
