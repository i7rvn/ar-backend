const crypto = require('crypto');
const { query } = require('../../config/database');
const { generateSecret, getOtpAuthUrl, generateQRCode, verifyToken } = require('../../utils/totp');

const TOTP_ENC_KEY = process.env.TOTP_ENC_KEY
 ? crypto.createHash('sha256').update(process.env.TOTP_ENC_KEY).digest()
 : null;

const LEGACY_ENC_KEY = process.env.JWT_SECRET
 ? crypto.createHash('sha256').update(process.env.JWT_SECRET).digest()
 : null;

function requireEncryptionKey() {
 if (!TOTP_ENC_KEY) {
  throw new Error('TOTP_ENC_KEY غير مضبوط؛ تشفير TOTP يتطلب مفتاحاً مخصصاً');
 }
 return TOTP_ENC_KEY;
}

function encrypt(text) {
 const key = requireEncryptionKey();
 const iv = crypto.randomBytes(12);
 const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
 const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
 const tag = cipher.getAuthTag();
 return `gcm:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
 const parts = String(payload || '').split(':');

 if (parts.length === 5 && parts[0] === 'gcm' && parts[1] === 'v1') {
  const key = requireEncryptionKey();
  const iv = Buffer.from(parts[2], 'hex');
  const tag = Buffer.from(parts[3], 'hex');
  const data = Buffer.from(parts[4], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
 }

 // Backward compatibility for secrets written by the previous AES-CBC implementation.
 // They are re-encrypted with GCM after a successful read.
 if (parts.length === 2 && LEGACY_ENC_KEY) {
  const iv = Buffer.from(parts[0], 'hex');
  const data = Buffer.from(parts[1], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', LEGACY_ENC_KEY, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
 }

 throw new Error('تنسيق secret_enc غير معروف أو مفاتيح التشفير غير متاحة');
}

async function readAndUpgradeSecret(userId) {
 const result = await query(
  `SELECT secret_enc FROM totp_secrets WHERE user_id = $1 AND is_enabled = TRUE`,
  [userId]
 );
 if (!result.rows.length) return null;

 const stored = result.rows[0].secret_enc;
 const secret = decrypt(stored);

 if (!stored.startsWith('gcm:v1:')) {
  await query(
   `UPDATE totp_secrets SET secret_enc = $1 WHERE user_id = $2`,
   [encrypt(secret), userId]
  );
 }
 return secret;
}

async function setupTOTP(userId, email) {
 const secret = generateSecret();
 const otpAuthUrl = getOtpAuthUrl(secret, email);
 const qrCodeDataURL = await generateQRCode(otpAuthUrl);

 await query(
 `INSERT INTO totp_secrets (user_id, secret_enc, is_enabled)
 VALUES ($1, $2, FALSE)
 ON CONFLICT (user_id) DO UPDATE SET secret_enc = $2, is_enabled = FALSE`,
 [userId, encrypt(secret)]
 );

 return { secret, qrCodeDataURL };
}

async function confirmTOTP(userId, token) {
 const result = await query(`SELECT secret_enc FROM totp_secrets WHERE user_id = $1`, [userId]);
 if (result.rows.length === 0) return { valid: false, reason: 'لم يتم إنشاء secret بعد' };

 const secret = decrypt(result.rows[0].secret_enc);
 const valid = verifyToken(token, secret);
 if (!valid) return { valid: false, reason: 'كود خاطئ' };

 await query(
  `UPDATE totp_secrets SET is_enabled = TRUE, enabled_at = NOW(), secret_enc = $1 WHERE user_id = $2`,
  [encrypt(secret), userId]
 );
 return { valid: true };
}

async function verifyTOTPLogin(userId, token) {
 const secret = await readAndUpgradeSecret(userId);
 if (!secret) return true;
 return verifyToken(token, secret);
}

async function isTOTPEnabled(userId) {
 const result = await query(
  `SELECT is_enabled FROM totp_secrets WHERE user_id = $1`,
  [userId]
 );
 return result.rows[0]?.is_enabled || false;
}

async function shouldPromptTOTPSetup(userId) {
 const result = await query(
  `SELECT is_enabled, last_prompted_at FROM totp_secrets WHERE user_id = $1`,
  [userId]
 );
 if (result.rows.length === 0) return true;
 if (result.rows[0].is_enabled) return false;

 const lastPrompt = result.rows[0].last_prompted_at;
 if (!lastPrompt) return true;
 const daysSince = (Date.now() - new Date(lastPrompt).getTime()) / (1000 * 3600 * 24);
 return daysSince >= 7;
}

async function markPrompted(userId) {
 await query(
  `INSERT INTO totp_secrets (user_id, secret_enc, last_prompted_at)
   VALUES ($1, '', NOW())
   ON CONFLICT (user_id) DO UPDATE SET last_prompted_at = NOW()`,
  [userId]
 );
}

module.exports = {
 setupTOTP, confirmTOTP, verifyTOTPLogin, isTOTPEnabled,
 shouldPromptTOTPSetup, markPrompted,
};
