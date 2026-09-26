const { query } = require('../../config/database');
const { generateFingerprint, parseDevice } = require('../../utils/deviceParser');
const { enqueue } = require('../../config/queue');
const { sendAlert } = require('../../config/telegram');
const logger = require('../../config/logger');

// يُستدعى بعد كل دخول ناجح — يكشف إذا الجهاز جديد ويسجّله
async function registerDeviceOnLogin(userId, req, accessToken = null) {
 const userAgent = req.headers['user-agent'] || '';
 const ip = req.ip;
 const lang = req.headers['accept-language'] || '';
 const fingerprint = generateFingerprint(userAgent, ip, lang);
 const { deviceType, deviceName } = parseDevice(userAgent);

 // كل دخول جديد: نصفّر is_current لكل أجهزة هذا المستخدم أولاً، بعدها
 // نفعّلها للجهاز الحالي فقط - بدون هذا تبقى القيمة صحيحة لأول جهاز
 // فقط للأبد بلا معنى حقيقي بعد أول دخول تالٍ من جهاز آخر
 await query(`UPDATE sessions_devices SET is_current = FALSE WHERE user_id = $1`, [userId]);

 const existing = await query(
 `SELECT id FROM sessions_devices WHERE user_id = $1 AND fingerprint = $2`,
 [userId, fingerprint]
 );

 if (existing.rows.length > 0) {
 await query(
 `UPDATE sessions_devices SET last_seen_at = NOW(), ip_address = $1, is_current = TRUE, access_token = $2 WHERE id = $3`,
 [ip, accessToken, existing.rows[0].id]
 );
 return { isNewDevice: false, deviceId: existing.rows[0].id };
 }

 // جهاز جديد
 const inserted = await query(
 `INSERT INTO sessions_devices (user_id, fingerprint, device_name, device_type, ip_address, is_current, access_token)
 VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id`,
 [userId, fingerprint, deviceName, deviceType, ip, accessToken]
 );

 const alreadyAlerted = await query(
 `SELECT id FROM new_device_alerts WHERE user_id = $1 AND fingerprint = $2`,
 [userId, fingerprint]
 );

 if (alreadyAlerted.rows.length === 0) {
 const userResult = await query(`SELECT email, username FROM users WHERE id = $1`, [userId]);
 const user = userResult.rows[0];
 if (user) {
 await enqueue('generic-emails', {
 type: 'raw-email',
 email: user.email,
 subject: 'تسجيل دخول من جهاز جديد',
 text: `تم تسجيل الدخول لحسابك @${user.username} من جهاز جديد: ${deviceName} (IP: ${ip}).\nإذا لم يكن أنت، غيّر كلمة مرورك فوراً.`,
 });
 await query(
 `INSERT INTO new_device_alerts (user_id, fingerprint) VALUES ($1, $2)`,
 [userId, fingerprint]
 );
 await sendAlert(`جهاز جديد لمستخدم @${user.username} - ${deviceName}`, 'warning');
 }
 }

 logger.info(`جهاز جديد مسجّل للمستخدم ${userId}: ${deviceName}`);
 return { isNewDevice: true, deviceId: inserted.rows[0].id };
}

module.exports = { registerDeviceOnLogin };
