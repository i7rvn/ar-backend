// كلمات المرور تُحفظ بـ Argon2id وفق مواصفات المشروع
const argon2 = require('argon2');
const { query } = require('../../config/database');
const { checkPasswordStrength } = require('../../utils/zxcvbn');
const { getSetting } = require('../../config/settings');

async function hashPassword(password) {
 return argon2.hash(password, { type: argon2.argon2id });
}

async function verifyPassword(hash, password) {
 try {
 return await argon2.verify(hash, password);
 } catch {
 return false;
 }
}

// يفحص قوة كلمة المرور + عدم تكرار آخر N كلمة مرور
async function validateNewPassword(userId, password, userInputs = []) {
 const strength = checkPasswordStrength(password, userInputs);
 if (!strength.isAcceptable) {
 return { valid: false, reason: 'كلمة المرور ضعيفة جداً', strength };
 }

 const historyCount = parseInt(await getSetting('password_history_count', 5));
 const history = await query(
 `SELECT password_hash FROM password_history
 WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
 [userId, historyCount]
 );

 for (const row of history.rows) {
 if (await verifyPassword(row.password_hash, password)) {
 return { valid: false, reason: `لا يمكن استخدام آخر ${historyCount} كلمات مرور سابقة`, strength };
 }
 }

 return { valid: true, strength };
}

// تُستدعى بعد تغيير كلمة مرور ناجح
async function recordPasswordChange(userId, newHash) {
 await query(
 `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
 [userId, newHash]
 );
 // نحافظ فقط على آخر 10 قيود (تنظيف تلقائي)
 await query(
 `DELETE FROM password_history WHERE user_id = $1 AND id NOT IN (
 SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10
 )`,
 [userId]
 );
}

module.exports = { hashPassword, verifyPassword, validateNewPassword, recordPasswordChange };
