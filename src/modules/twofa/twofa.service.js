const crypto = require('crypto');
const { query } = require('../../config/database');
const { generateSecret, getOtpAuthUrl, generateQRCode, verifyToken } = require('../../utils/totp');

const ENC_KEY = crypto.createHash('sha256').update(process.env.TOTP_ENC_KEY || process.env.JWT_SECRET).digest();

function encrypt(text) {
 const iv = crypto.randomBytes(16);
 const cipher = crypto.createCipheriv('aes-256-cbc', ENC_KEY, iv);
 const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
 return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
 const [ivHex, dataHex] = payload.split(':');
 const decipher = crypto.createDecipheriv('aes-256-cbc', ENC_KEY, Buffer.from(ivHex, 'hex'));
 const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
 return decrypted.toString('utf8');
}

// خطوة 1: توليد secret + QR (بعدها التفعيل الفعلي بيجي بعد تأكيد كود صحيح)
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

// خطوة 2: تأكيد التفعيل بأول كود صحيح
async function confirmTOTP(userId, token) {
 const result = await query(`SELECT secret_enc FROM totp_secrets WHERE user_id = $1`, [userId]);
 if (result.rows.length === 0) return { valid: false, reason: 'لم يتم إنشاء secret بعد' };

 const secret = decrypt(result.rows[0].secret_enc);
 const valid = verifyToken(token, secret);
 if (!valid) return { valid: false, reason: 'كود خاطئ' };

 await query(
 `UPDATE totp_secrets SET is_enabled = TRUE, enabled_at = NOW() WHERE user_id = $1`,
 [userId]
 );
 return { valid: true };
}

async function verifyTOTPLogin(userId, token) {
 const result = await query(
 `SELECT secret_enc FROM totp_secrets WHERE user_id = $1 AND is_enabled = TRUE`,
 [userId]
 );
 if (result.rows.length === 0) return true; // 2FA غير مفعّل، نعتبرها ناجحة

 const secret = decrypt(result.rows[0].secret_enc);
 return verifyToken(token, secret);
}

async function isTOTPEnabled(userId) {
 const result = await query(
 `SELECT is_enabled FROM totp_secrets WHERE user_id = $1`,
 [userId]
 );
 return result.rows[0]?.is_enabled || false;
}

// نافذة ترحيبية ذكية: تظهر بعد أول دخول، وتتكرر كل فترة لحد ما يفعّل
async function shouldPromptTOTPSetup(userId) {
 const result = await query(
 `SELECT is_enabled, last_prompted_at FROM totp_secrets WHERE user_id = $1`,
 [userId]
 );
 if (result.rows.length === 0) return true; // ما عندوش secret أصلاً
 if (result.rows[0].is_enabled) return false; // مفعّل، ما نزعجوش

 const lastPrompt = result.rows[0].last_prompted_at;
 if (!lastPrompt) return true;
 const daysSince = (Date.now() - new Date(lastPrompt).getTime()) / (1000 * 3600 * 24);
 return daysSince >= 7; // نذكّره كل أسبوع
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
