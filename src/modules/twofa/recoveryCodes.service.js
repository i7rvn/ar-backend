const crypto = require('crypto');
const argon2 = require('argon2'); // نفس خوارزم كلمات المرور (Argon2id) المستخدم بالمشروع كامل
const { query } = require('../../config/database');
const { consumeMatchingCode } = require('../../utils/recoveryCodeClaim');

// توليد 10 أكواد احتياطية — تُعرض للمستخدم مرة واحدة فقط، ونخزّن الـ hash برك
async function generateRecoveryCodes(userId) {
 const plainCodes = Array.from({ length: 10 }, () =>
 crypto.randomBytes(5).toString('hex').toUpperCase()
 );

 await query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);

 for (const code of plainCodes) {
 const hash = await argon2.hash(code, { type: argon2.argon2id });
 await query(
 `INSERT INTO recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
 [userId, hash]
 );
 }

 return plainCodes; // تُعرض مرة وحدة فقط بالواجهة
}

async function consumeRecoveryCode(userId, code) {
 const result = await query(
 `SELECT id, code_hash FROM recovery_codes WHERE user_id = $1 AND used = FALSE`,
 [userId]
 );

 return consumeMatchingCode(result.rows, code, argon2.verify, async (rowId) => {
  const claimed = await query(
   `UPDATE recovery_codes SET used = TRUE, used_at = NOW()
    WHERE id = $1 AND user_id = $2 AND used = FALSE RETURNING id`,
   [rowId, userId]
  );
  return claimed.rowCount === 1;
 });
}

async function remainingCodesCount(userId) {
 const result = await query(
 `SELECT COUNT(*) FROM recovery_codes WHERE user_id = $1 AND used = FALSE`,
 [userId]
 );
 return parseInt(result.rows[0].count);
}

module.exports = { generateRecoveryCodes, consumeRecoveryCode, remainingCodesCount };

