const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../../config/logger');
const { query, withTransaction } = require('../../config/database');
const {
 setOTP, getOTP, deleteOTP,
 incrementOTPAttempts, getOTPAttempts,
 blacklistToken,
} = require('../../config/redis');
const { sendOTPEmail } = require('../../config/email');

// ─── توليد OTP ────────────────────────────────────────────────
function generateOTP() {
 return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── توليد JWT ────────────────────────────────────────────────
function generateTokens(userId) {
 // jti عشوائي إجباري: بلا هذا، كل توكنين يصدرا لنفس المستخدم بنفس
 // الثانية (iat متطابق) يطلعا متطابقين حرفياً - إبطال واحد (مثلاً
 // تسجيل خروج من جهاز) يبطّل الآخر معاه بالخطأ لأنهما نفس النص
 const accessToken = jwt.sign(
 { userId, jti: crypto.randomUUID() },
 process.env.JWT_SECRET,
 { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
 );
 const refreshToken = jwt.sign(
 { userId, jti: crypto.randomUUID() },
 process.env.JWT_REFRESH_SECRET,
 { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
 );
 return { accessToken, refreshToken };
}

// ─── إرسال OTP ────────────────────────────────────────────────
// إرسال OTP لتأكيد بريد إلكتروني قبل التسجيل
// عند فشل الإرسال المباشر، تُجدوَل محاولة إعادة تلقائية بفاصل زمني
// تصاعدي عبر نظام Queue. أي طلب جديد لكود لنفس البريد يزيد رمزاً
// تسلسلياً بـ Redis، والمحاولة المؤجَّلة تتحقق منه قبل التنفيذ حتى
// لا تُرسِل كوداً قديماً تجاوزه طلب أحدث.
async function sendOTP(email) {
 const { canRegisterWithEmail } = require('../users/linkedAccounts.service');
 const emailCheck = await canRegisterWithEmail(email);
 if (!emailCheck.allowed) {
 throw {
 status: 409,
 message: `لا يمكن استخدام هذا البريد، الحد الأقصى ${emailCheck.max} حسابات لكل بريد إلكتروني`,
 code: 'EMAIL_ACCOUNT_LIMIT',
 };
 }

 const { client: redisClient } = require('../../config/redis');
 const { enqueueDelayed } = require('../../config/queue');

 const otp = generateOTP();
 await setOTP(email, otp);
 const token = await redisClient.incr(`otp_token:${email}`);

 try {
 await sendOTPEmail(email, otp);
 } catch (err) {
 logger.error(`فشل الإرسال المباشر لـ OTP، جدولة إعادة محاولة لـ ${email}:`, err.message);
 await enqueueDelayed('otp-retry', { email, token }, 15);
 }

 logger.info(`OTP أُرسل إلى ${email}`);
 return true;
}

// ─── التحقق من OTP ────────────────────────────────────────────
async function verifyOTP(email, code) {
 // تحقق من عدد المحاولات
 const attempts = await getOTPAttempts(email);
 if (attempts >= 5) {
 throw { status: 429, message: 'محاولات كثيرة، انتظر ساعة', code: 'TOO_MANY_ATTEMPTS' };
 }

 const storedOTP = await getOTP(email);
 if (!storedOTP) {
 throw { status: 400, message: 'الكود منتهي أو غير موجود', code: 'OTP_EXPIRED' };
 }

 if (storedOTP !== code) {
 await incrementOTPAttempts(email);
 throw { status: 400, message: 'الكود غير صحيح', code: 'INVALID_OTP' };
 }

 await deleteOTP(email);
 return true;
}

// ─── التسجيل الكامل ───────────────────────────────────────────
async function register({ email, username, password, display_name }, req = {}) {
 const usernameLower = username.toLowerCase();

 // اسم مستخدم محجوز
 const reserved = await query('SELECT username FROM reserved_usernames WHERE username = $1', [usernameLower]);
 if (reserved.rows.length > 0) {
 throw { status: 400, message: 'اسم المستخدم هذا محجوز', code: 'USERNAME_RESERVED' };
 }

 // حد أقصى 3 حسابات لكل بريد إلكتروني (رقم قابل للتعديل من إعدادات النظام)
 const { canRegisterWithEmail } = require('../users/linkedAccounts.service');
 const emailCheck = await canRegisterWithEmail(email);
 if (!emailCheck.allowed) {
 throw {
 status: 409,
 message: `لا يمكن إنشاء حساب جديد، الحد الأقصى ${emailCheck.max} حسابات لكل بريد إلكتروني`,
 code: 'EMAIL_ACCOUNT_LIMIT',
 };
 }

 // فحص قوة كلمة المرور
 const { checkPasswordStrength } = require('../../utils/zxcvbn');
 const strength = checkPasswordStrength(password, [email, username, display_name]);
 if (!strength.isAcceptable) {
 throw { status: 400, message: 'كلمة المرور ضعيفة جداً، اختر كلمة مرور أقوى', code: 'WEAK_PASSWORD' };
 }

 const { user, accessToken, refreshToken } = await withTransaction(async (client) => {
 const exists = await client.query(
 'SELECT id FROM users WHERE username=$1',
 [usernameLower]
 );
 if (exists.rows.length > 0) {
 throw { status: 409, message: 'اسم المستخدم مستخدم بالفعل', code: 'USERNAME_TAKEN' };
 }

 const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

 const result = await client.query(
 `INSERT INTO users (email, username, password_hash, display_name, is_verified)
 VALUES ($1, $2, $3, $4, TRUE)
 RETURNING id, email, username, display_name, is_verified, created_at, internal_id`,
 [email, usernameLower, passwordHash, display_name]
 );

 const newUser = result.rows[0];
 const tokens = generateTokens(newUser.id);

 await client.query(
 `INSERT INTO security_logs (user_id, ip_address, event_type, severity)
 VALUES ($1, $2, 'register', 'info')`,
 [newUser.id, req.ip || null]
 );

 await client.query(
 `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
 [newUser.id, passwordHash]
 );

 return { user: newUser, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
 });

 const { linkAccount } = require('../users/linkedAccounts.service');
 await linkAccount(email, user.id);

 if (req.headers) {
 const { registerDeviceOnLogin } = require('./device.service');
 registerDeviceOnLogin(user.id, req, accessToken).catch((e) => logger.error(e));
 }

 const { enqueue } = require('../../config/queue');
 const userAgent = req.headers?.['user-agent'] || '';
 await enqueue('generic-emails', {
 type: 'welcome',
 email,
 displayName: display_name,
 meta: { ip: req.ip, userAgent, createdAt: user.created_at },
 });

 return { user, accessToken, refreshToken };
}

// ─── تسجيل الدخول ─────────────────────────────────────────────
// رسالة الخطأ عامة وموحّدة لعدم وجود البريد أو خطأ كلمة المرور،
// لمنع اكتشاف المهاجم لوجود بريد معيّن من عدمه (user enumeration)
// المعرّف (identifier) يقبل بريداً أو اسم مستخدم. اسم المستخدم فريد
// دائماً فيرجع صفاً واحداً، لكن البريد قد يطابق عدة حسابات (حتى 3،
// حسب حد system_settings) - في هذي الحالة تُقارَن كلمة المرور مع كل
// حساب مطابق، ويُختار الحساب الذي تُطابق كلمة مروره فعلياً، بلا حاجة
// لواجهة اختيار حساب منفصلة.
async function login({ identifier, password, totpCode, recoveryCode }, ip, req = {}) {
 const result = await query(
 `SELECT id, email, username, display_name, avatar_url,
 password_hash, is_verified, is_admin, is_banned, ban_reason
 FROM users WHERE username = $1 OR email = $1`,
 [identifier]
 );

 if (result.rows.length === 0) {
 throw { status: 401, message: 'بيانات غير صحيحة', code: 'INVALID_CREDENTIALS' };
 }

 let user = null;
 for (const candidate of result.rows) {
 const matches = await argon2.verify(candidate.password_hash, password);
 if (matches) { user = candidate; break; }
 }

 if (!user) {
 await query(
 `INSERT INTO security_logs (user_id, ip_address, event_type, severity)
 VALUES ($1, $2, 'login_failed', 'warning')`,
 [result.rows[0].id, ip]
 );
 throw { status: 401, message: 'بيانات غير صحيحة', code: 'INVALID_CREDENTIALS' };
 }

 if (user.is_banned) {
 throw { status: 403, message: `حسابك موقوف: ${user.ban_reason || 'مخالفة للشروط'}`, code: 'BANNED' };
 }

 // التحقق بخطوتين، إذا كان مفعّلاً على هذا الحساب
 const { isTOTPEnabled, verifyTOTPLogin } = require('../twofa/twofa.service');
 const { consumeRecoveryCode } = require('../twofa/recoveryCodes.service');

 const totpEnabled = await isTOTPEnabled(user.id);
 if (totpEnabled) {
 if (recoveryCode) {
 const validRecovery = await consumeRecoveryCode(user.id, recoveryCode);
 if (!validRecovery) {
 throw { status: 401, message: 'كود الاسترجاع غير صحيح', code: 'INVALID_RECOVERY_CODE' };
 }
 } else if (totpCode) {
 const validTotp = await verifyTOTPLogin(user.id, totpCode);
 if (!validTotp) {
 throw { status: 401, message: 'كود التحقق غير صحيح', code: 'INVALID_2FA_CODE' };
 }
 } else {
 // لا سماح بالدخول بلا كود عندما يكون التحقق بخطوتين مفعّلاً
 const err = { status: 428, message: 'التحقق بخطوتين مطلوب', code: 'TOTP_REQUIRED', requiresTOTP: true };
 throw err;
 }
 }

 const { accessToken, refreshToken } = generateTokens(user.id);

 await query(
 `INSERT INTO security_logs (user_id, ip_address, event_type, severity)
 VALUES ($1, $2, 'login_success', 'info')`,
 [user.id, ip]
 );

 // كشف جهاز جديد + إشعار بريد عند الحاجة
 if (req.headers) {
 const { registerDeviceOnLogin } = require('./device.service');
 registerDeviceOnLogin(user.id, req, accessToken).catch((e) => logger.error(e));
 }

 // إلغاء طلب حذف الحساب تلقائياً إذا كان قائماً
 const { cancelDeletionIfExists } = require('../users/accountDeletion.service');
 cancelDeletionIfExists(user.id).catch((e) => logger.error(e));

 const { password_hash, ...userWithoutPassword } = user;
 return { user: userWithoutPassword, accessToken, refreshToken };
}

// ─── تسجيل الخروج ─────────────────────────────────────────────
async function logout(token, userId) {
 // أضف الـ token للقائمة السوداء
 await blacklistToken(token, 7 * 24 * 60 * 60); // 7 أيام

 await query(
 `INSERT INTO security_logs (user_id, event_type, severity)
 VALUES ($1, 'logout', 'info')`,
 [userId]
 );
}

// ─── تجديد الـ Token ───────────────────────────────────────────
async function refreshAccessToken(refreshToken) {
 try {
 const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
 const { accessToken } = generateTokens(decoded.userId);
 return { accessToken };
 } catch {
 throw { status: 401, message: 'رمز التجديد غير صالح', code: 'INVALID_REFRESH' };
 }
}

module.exports = {
 sendOTP, verifyOTP, register,
 login, logout, refreshAccessToken,
};
