// ═══════════════════════════════════════════════════════════════
// AR App — Encryption Service
// إدارة مفاتيح المستخدمين + Master Password
// ═══════════════════════════════════════════════════════════════

const { query, withTransaction } = require('../../config/database');
const securityClient = require('../ai-filter/security.client');
const logger = require('../../config/logger');

// ─── إنشاء مفاتيح لمستخدم جديد ───────────────────────────────
async function createUserKeys(userId) {
 try {
 // 1. توليد زوج مفاتيح X25519 للـ E2E
 const keyPair = await securityClient.generateKeyPair();

 // 2. توليد مفتاح تشفير البيانات الشخصية
 const crypto = require('crypto');
 const dataKey = crypto.randomBytes(32).toString('base64');

 // 3. تشفير المفتاح الخاص ومفتاح البيانات بـ Master Key
 const encPrivateKey = await securityClient.encryptUserKey(keyPair.private_key);
 const encDataKey = await securityClient.encryptUserKey(dataKey);

 // 4. حفظ في القاعدة
 await query(
 `INSERT INTO encryption_keys
 (user_id, encrypted_private_key, public_key, encrypted_data_key)
 VALUES ($1, $2, $3, $4)
 ON CONFLICT (user_id) DO NOTHING`,
 [userId, JSON.stringify(encPrivateKey), keyPair.public_key, JSON.stringify(encDataKey)]
 );

 logger.info(`تم إنشاء مفاتيح تشفير للمستخدم ${userId}`);
 return { publicKey: keyPair.public_key };

 } catch (err) {
 // إذا Rust Service مش شغال (Master Key مقفل)، نتجاوز
 logger.warn(`تعذّر إنشاء مفاتيح: ${err.message}`);
 return null;
 }
}

// ─── جلب المفتاح العام لمستخدم ────────────────────────────────
async function getUserPublicKey(userId) {
 const result = await query(
 `SELECT public_key FROM encryption_keys WHERE user_id = $1`, [userId]
 );
 return result.rows[0]?.public_key || null;
}

// ─── فك تشفير مفتاح مستخدم (يحتاج Master Key مفتوح) ──────────
async function getUserDataKey(userId) {
 const result = await query(
 `SELECT encrypted_data_key FROM encryption_keys WHERE user_id = $1`, [userId]
 );
 if (!result.rows[0]) throw new Error('لا يوجد مفتاح لهذا المستخدم');

 const encDataKey = JSON.parse(result.rows[0].encrypted_data_key);
 return await securityClient.decryptUserKey(encDataKey);
}

// ─── تشفير بيانات مستخدم ──────────────────────────────────────
async function encryptUserData(userId, plaintext) {
 try {
 const dataKeyB64 = await getUserDataKey(userId);
 return await securityClient.encryptData(plaintext, 'aes256', dataKeyB64);
 } catch (err) {
 logger.warn(`تشفير البيانات فشل (Master Key مقفل?): ${err.message}`);
 return null;
 }
}

// ─── فك تشفير بيانات مستخدم ───────────────────────────────────
async function decryptUserData(userId, encryptedData) {
 const dataKeyB64 = await getUserDataKey(userId);
 return await securityClient.decryptData(encryptedData, dataKeyB64);
}

// ─── تدوير المفاتيح (كل 30 يوم) ──────────────────────────────
async function rotateExpiredKeys() {
 try {
 const expired = await query(
 `SELECT user_id, key_version FROM encryption_keys
 WHERE last_rotated_at < NOW() - INTERVAL '30 days'
 LIMIT 50`
 );

 for (const row of expired.rows) {
 try {
 // توليد مفاتيح جديدة
 const crypto = require('crypto');
 const newDataKey = crypto.randomBytes(32).toString('base64');
 const encNewKey = await securityClient.encryptUserKey(newDataKey);

 await withTransaction(async (client) => {
 // حفظ المفتاح الجديد
 await client.query(
 `UPDATE encryption_keys
 SET encrypted_data_key = $1,
 key_version = key_version + 1,
 last_rotated_at = NOW()
 WHERE user_id = $2`,
 [JSON.stringify(encNewKey), row.user_id]
 );

 // سجل التدوير
 await client.query(
 `INSERT INTO key_rotations (user_id, old_version, new_version, rotated_by)
 VALUES ($1, $2, $3, 'auto')`,
 [row.user_id, row.key_version, row.key_version + 1]
 );
 });

 logger.info(`تم تدوير مفتاح المستخدم ${row.user_id}`);
 } catch (err) {
 logger.error(`فشل تدوير مفتاح ${row.user_id}: ${err.message}`);
 }
 }

 if (expired.rows.length > 0) {
 logger.info(`تم تدوير ${expired.rows.length} مفتاح`);
 }
 } catch (err) {
 logger.error('خطأ في تدوير المفاتيح:', err);
 }
}

module.exports = {
 createUserKeys,
 getUserPublicKey,
 getUserDataKey,
 encryptUserData,
 decryptUserData,
 rotateExpiredKeys,
};
