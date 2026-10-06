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
const { sendOTPWhatsApp } = require('../../config/whatsapp');
const { isOtpVerificationEnabled } = require('../../config/security');

// ─── توليد OTP ────────────────────────────────────────────────
function generateOTP() {
 return crypto.randomInt(100000, 1000000).toString();
}

// ─── توليد JWT ────────────────────────────────────────────────
// tokenVersion: يُقارَن مع users.token_version بكل طلب — تصفيره أو
// زيادته (عند تغيير كلمة السر أو الحظر) يبطّل فوراً كل التوكنات
// الصادرة قبل الزيادة، بلا حاجة نعرف نصوصها.
// deviceId: id تبع صف sessions_devices المرتبط بهذي الجلسة —
// يسمح بإبطال جهاز واحد بالضبط عبر revoked_at، بلا الاعتماد على
// حفظ نص التوكن الخام ومطابقته لاحقاً.
function generateTokens(userId, { tokenVersion = 0, deviceId = null } = {}) {
 // jti عشوائي إجباري: بلا هذا، كل توكنين يصدرا لنفس المستخدم بنفس
 // الثانية (iat متطابق) يطلعا متطابقين حرفياً - إبطال واحد (مثلاً
 // تسجيل خروج من جهاز) يبطّل الآخر معاه بالخطأ لأنهما نفس النص
 const accessToken = jwt.sign(
 { userId, tv: tokenVersion, did: deviceId, jti: crypto.randomUUID() },
 process.env.JWT_SECRET,
 { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
 );
 const refreshToken = jwt.sign(
 { userId, tv: tokenVersion, did: deviceId, jti: crypto.randomUUID() },
 process.env.JWT_REFRESH_SECRET,
 { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
 );
 return { accessToken, refreshToken };
}

// ─── إرسال OTP ────────────────────────────────────────────────
// identifier: بريد إلكتروني أو رقم هاتف (بصيغة دولية +213...) حسب channel
// channel: 'email' (افتراضي) أو 'whatsapp'
// عند فشل الإرسال المباشر، تُجدوَل محاولة إعادة تلقائية بفاصل زمني
// تصاعدي عبر نظام Queue (البريد فقط حالياً — واتساب يفشل بوضوح
// فوراً بلا طابور، لأن فشل قالب معتمد غالباً خطأ إعداد دائم لا يستفيد
// من إعادة المحاولة، خلافاً لمهلة SMTP العابرة). أي طلب جديد لكود
// لنفس المعرِّف يزيد رمزاً تسلسلياً بـ Redis، والمحاولة المؤجَّلة
// تتحقق منه قبل التنفيذ حتى لا تُرسِل كوداً قديماً تجاوزه طلب أحدث.
async function sendOTP(identifier, channel = 'email') {
 if (channel === 'email') {
 const { canRegisterWithEmail } = require('../users/linkedAccounts.service');
 const emailCheck = await canRegisterWithEmail(identifier);
 if (!emailCheck.allowed) {
 throw {
 status: 409,
 message: `لا يمكن استخدام هذا البريد، الحد الأقصى ${emailCheck.max} حسابات لكل بريد إلكتروني`,
 code: 'EMAIL_ACCOUNT_LIMIT',
 };
 }
 }

 const { client: redisClient } = require('../../config/redis');
 const { enqueueDelayed } = require('../../config/queue');

 // مفتاح مسبوق بالقناة: بلا هذا، إعادة إرسال بقناة مختلفة لنفس
 // المعرِّف (نادر لكن ممكن) يبطّل كود القناة الأولى بالخطأ
 const otpKey = `${channel}:${identifier}`;
 const otp = generateOTP();
 await setOTP(otpKey, otp);
 const token = await redisClient.incr(`otp_token:${otpKey}`);

 // للتطوير المحلي فقط: يطبع الكود بالـ console بدل الاعتماد على مزوّد
 // حقيقي — مقفول بصرامة خلف NODE_ENV==='development'، صفر أثر بالإنتاج
 if (process.env.NODE_ENV === 'development') {
 // eslint-disable-next-line no-console
 console.log(`\n📧 [DEV ONLY] كود OTP لـ ${identifier} (${channel}): ${otp}\n`);
 }

 let sentImmediately = true;
 try {
 if (channel === 'whatsapp') {
 await sendOTPWhatsApp(identifier, otp);
 } else {
 await sendOTPEmail(identifier, otp);
 }
 } catch (err) {
 sentImmediately = false;
 logger.error(`فشل الإرسال المباشر لـ OTP (${channel})، `
 + (channel === 'email' ? 'جدولة إعادة محاولة' : 'بلا طابور') + ` لـ ${identifier}:`, err.message);
 if (process.env.NODE_ENV !== 'development' && channel === 'email') {
 await enqueueDelayed('otp-retry', { email: identifier, token }, 15);
 } else if (channel === 'whatsapp') {
 // نرفع الخطأ فوراً للمتحكم بدل الصمت — المستخدم يحتاج يعرف
 // فوراً أن واتساب فشل، خصوصاً أن التطبيق بلا طابور لهذي القناة
 throw { status: 502, message: 'فشل إرسال الكود عبر واتساب، جرّب البريد الإلكتروني', code: 'WHATSAPP_SEND_FAILED' };
 }
 }

 // رسالة اللوق تعكس الواقع الفعلي: نجاح مباشر ماشي كيف جدولة محاولة
 // لاحقة (لي تقدر تفشل هي الأخرى، مثلاً بسبب دومين Resend غير موثّق
 // بعد — راجع اللوقات إذا هذي الرسالة تتكرر كثير رغم "النجاح" الظاهري)
 if (sentImmediately) {
 logger.info(`OTP أُرسل إلى ${identifier} عبر ${channel}`);
 } else {
 logger.warn(`OTP لـ ${identifier} لم يُرسَل فوراً — بانتظار إعادة المحاولة المجدولة (15 ثانية)`);
 }
 return true;
}

// ─── التحقق من OTP ────────────────────────────────────────────
async function verifyOTP(identifier, code, channel = 'email') {
 const otpKey = `${channel}:${identifier}`;

 // تحقق من عدد المحاولات
 const attempts = await getOTPAttempts(otpKey);
 if (attempts >= 5) {
 throw { status: 429, message: 'محاولات كثيرة، انتظر ساعة', code: 'TOO_MANY_ATTEMPTS' };
 }

 const storedOTP = await getOTP(otpKey);
 if (!storedOTP) {
 throw { status: 400, message: 'الكود منتهي أو غير موجود', code: 'OTP_EXPIRED' };
 }

 if (storedOTP !== code) {
 await incrementOTPAttempts(otpKey);
 throw { status: 400, message: 'الكود غير صحيح', code: 'INVALID_OTP' };
 }

 await deleteOTP(otpKey);

 // علم تحقق قصير المدى يستهلكه register() بعدها — بلا هذا، أي حد
 // يقدر يستدعي /auth/register مباشرة بلا ما يمر أصلاً من /verify-otp
 // (ثغرة كانت موجودة حتى قبل إضافة واتساب، راجع CHANGELOG)
 const { setCache } = require('../../config/redis');
 await setCache(`otp_verified:${otpKey}`, true, 900); // 15 دقيقة

 return true;
}

// ─── التسجيل الكامل ───────────────────────────────────────────
// otp_channel: القناة اللي اتحقق منها المستخدم فعلاً ('email' أو
// 'whatsapp') — لازم نعرفها بالضبط باش نفحص علم otp_verified الصحيح
async function register({ email, username, password, display_name, invite_code, phone_number, otp_channel = 'email' }, req = {}) {
 const usernameLower = username.toLowerCase();

 // ⚠️ مفتاح طوارئ مؤقت: SKIP_OTP_VERIFICATION=true بمتغيرات البيئة
 // يعطّل فحص التحقق تماماً — يُستعمل فقط أثناء مشكلة تقنية بمزوّد
 // البريد (دومين Resend غير موثّق حالياً). خطر أمني حقيقي طول ما هو
 // مفعّل: أي حد يقدر يسجّل بأي إيميل/رقم بلا أي تحقق فعلي من ملكيته
 // (بريد مزيّف، حسابات وهمية بالجملة). فعّلها فقط للمدة الضرورية،
 // وأطفئها فوراً بعد توثيق الدومين — راجع .env.example للتفاصيل.
 const otpVerificationEnabled = isOtpVerificationEnabled();

 // تحقق أن OTP اتأكد فعلاً لنفس القناة والمعرِّف قبل إنشاء أي حساب —
 // بلا هذا الفحص، أي حد يقدر يستدعي /auth/register مباشرة بلا ما
 // يمر أصلاً من /auth/verify-otp (ثغرة كانت موجودة بالكود الأصلي)
 const verifiedIdentifier = otp_channel === 'whatsapp' ? phone_number : email;
 if (req.headers && otpVerificationEnabled) { // فقط لطلبات HTTP حقيقية، ماشي سكربتات داخلية
 const { getCache, deleteCache } = require('../../config/redis');
 const verifiedFlag = await getCache(`otp_verified:${otp_channel}:${verifiedIdentifier}`);
 if (!verifiedFlag) {
 throw { status: 400, message: 'لازم تتحقق من رمز التأكيد أولاً', code: 'OTP_NOT_VERIFIED' };
 }
 await deleteCache(`otp_verified:${otp_channel}:${verifiedIdentifier}`); // استهلاك لمرة وحدة
 } else if (!otpVerificationEnabled) {
 logger.warn(`تسجيل بلا تحقق OTP (SKIP_OTP_VERIFICATION مفعّل) — ${email || phone_number}`);
 }

 // الحظر اليدوي (blocked_ips) يبقى مفعّل دائماً، حتى بكود دعوة صالح —
 // هذا حظر إداري صريح لعنوان بعينه، ماشي فحص جغرافي عام
 const { getClientIP, isManuallyBlocked, checkVPN } = require('../../middleware/vpn');
 const ip = req.ip || getClientIP(req);
 if (req.headers && (await isManuallyBlocked(ip))) {
 throw { status: 403, message: 'تم حظر هذا العنوان من الوصول للمنصة.', code: 'IP_BLOCKED' };
 }

 // ─── إعفاء جغرافي دائم عبر كود دعوة (للمغتربين) ─────────────────
 let geoExempt = false;
 if (invite_code) {
 const { consumeInviteCode } = require('./inviteCodes.service');
 // نتحقق بس من صلاحية الكود هنا (بلا استهلاكه بعد) — الاستهلاك
 // الفعلي والذري يصير بعد إنشاء المستخدم بنجاح (تحته)، باش ما
 // نحرقش كوداً لو التسجيل فشل لسبب آخر (يوزرنيم مأخوذ مثلاً)
 const check = await query(
 `SELECT 1 FROM invite_codes WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()`,
 [invite_code]
 );
 if (check.rows.length === 0) {
 throw { status: 400, message: 'كود الدعوة غير صالح أو منتهي', code: 'INVALID_INVITE_CODE' };
 }
 geoExempt = true;
 } else if (req.headers) {
 // بلا كود دعوة: نفس فحص vpnGuard العادي (VPN/Proxy/Tor/خارج الجزائر)
 const result = await checkVPN(ip);
 if (result.isVPN) throw { status: 403, message: 'AR متاح فقط للمستخدمين في الجزائر. VPN غير مسموح به.', code: 'VPN_DETECTED' };
 if (result.isProxy) throw { status: 403, message: 'AR متاح فقط للمستخدمين في الجزائر. البروكسي غير مسموح به.', code: 'PROXY_DETECTED' };
 if (result.isTor) throw { status: 403, message: 'شبكة Tor غير مسموح بها على AR.', code: 'TOR_DETECTED' };
 if (!result.isAlgeria && result.country !== 'UNKNOWN') {
 throw { status: 403, message: 'AR متاح فقط للمستخدمين داخل الجزائر — أو استعمل كود دعوة إذا كنت مغترباً', code: 'NOT_ALGERIA' };
 }
 }

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

 const { user } = await withTransaction(async (client) => {
 const exists = await client.query(
 'SELECT id FROM users WHERE username=$1',
 [usernameLower]
 );
 if (exists.rows.length > 0) {
 throw { status: 409, message: 'اسم المستخدم مستخدم بالفعل', code: 'USERNAME_TAKEN' };
 }

 if (phone_number) {
 const phoneExists = await query('SELECT id FROM users WHERE phone_number = $1', [phone_number]);
 if (phoneExists.rows.length > 0) {
 throw { status: 409, message: 'رقم الهاتف مستخدم بالفعل', code: 'PHONE_TAKEN' };
 }
 }

 const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

 // ─── نسخة مشفَّرة حقيقية من البريد (بالإضافة لعمود email العادي،
 // ماشي بدلاً عنه — راجع ملاحظة أعلى الملف) ────────────────────
 const { encryptField, hashEmailForLookup } = require('../../utils/fieldCrypto');
 const dataSection = ['web', 'android', 'ios'].includes(req.clientName) ? req.clientName : 'web';
 const { enc, iv, tag } = encryptField(email, dataSection);
 const emailLookupHash = hashEmailForLookup(email);

 const result = await client.query(
 `INSERT INTO users (email, username, password_hash, display_name, is_verified,
 email_lookup_hash, email_enc, email_iv, email_tag, data_section, geo_exempt, phone_number)
 VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8, $9, $10, $11)
 RETURNING id, email, username, display_name, is_verified, created_at, internal_id`,
 [email, usernameLower, passwordHash, display_name, emailLookupHash, enc, iv, tag, dataSection, geoExempt, phone_number || null]
 );

 const newUser = result.rows[0];

 // استهلاك الكود فعلياً الآن (ذري، داخل نفس المعاملة) — لو حد آخر
 // استهلكه بنفس اللحظة بالضبط، الـ transaction كله يترجّع (rollback)
 if (invite_code) {
 const consumed = await client.query(
 `UPDATE invite_codes SET used_at = NOW(), used_by_user_id = $1
 WHERE code = $2 AND used_at IS NULL AND expires_at > NOW()
 RETURNING id`,
 [newUser.id, invite_code]
 );
 if (consumed.rows.length === 0) {
 throw { status: 409, message: 'كود الدعوة استُعمل للتو من طرف آخر، جرّب كوداً جديداً', code: 'INVITE_CODE_RACE' };
 }
 }

 await client.query(
 `INSERT INTO security_logs (user_id, ip_address, event_type, severity)
 VALUES ($1, $2, 'register', 'info')`,
 [newUser.id, req.ip || null]
 );

 await client.query(
 `INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)`,
 [newUser.id, passwordHash]
 );

 return { user: newUser };
 });

 const { linkAccount } = require('../users/linkedAccounts.service');
 await linkAccount(email, user.id);

 // تسجيل الجهاز يصير قبل توليد التوكنات (مو fire-and-forget بعدها)
 // باش نقدر نربط التوكن بمعرّف الجلسة (did) من أول لحظة
 let deviceId = null;
 if (req.headers) {
 const { registerDeviceOnLogin } = require('./device.service');
 try {
 const deviceResult = await registerDeviceOnLogin(user.id, req, null);
 deviceId = deviceResult.deviceId;
 } catch (e) {
 logger.error('فشل تسجيل الجهاز عند التسجيل:', e);
 }
 }

 const tokens = generateTokens(user.id, { tokenVersion: 0, deviceId });
 const { accessToken, refreshToken } = tokens;

 if (deviceId) {
 await query(`UPDATE sessions_devices SET access_token = $1 WHERE id = $2`, [accessToken, deviceId]);
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
 password_hash, is_verified, is_admin, is_banned, ban_reason, token_version, geo_exempt
 FROM users WHERE username = $1 OR email = $1`,
 [identifier]
 );

 // الحظر اليدوي (blocked_ips) دائماً مفعّل، حتى لحساب معفى جغرافياً
 const { isManuallyBlocked, checkVPN } = require('../../middleware/vpn');
 if (req.headers && (await isManuallyBlocked(ip))) {
 throw { status: 403, message: 'تم حظر هذا العنوان من الوصول للمنصة.', code: 'IP_BLOCKED' };
 }

 // فحص VPN/Geo — يتجاوَز فقط لو أحد الحسابات المطابقة لهذا المعرّف
 // عنده geo_exempt=true (المستخدم استعمل كود دعوة عند التسجيل).
 // نديرو الفحص قبل مطابقة كلمة السر (نفس ترتيب vpnGuard القديم) —
 // بلا كشف أي معلومة عن وجود الحساب من عدمه (رمز الخطأ ماشي مرتبط بالحساب)
 const anyExempt = result.rows.some((r) => r.geo_exempt);
 if (!anyExempt && req.headers) {
 const vpnResult = await checkVPN(ip);
 if (vpnResult.isVPN) throw { status: 403, message: 'AR متاح فقط للمستخدمين في الجزائر. VPN غير مسموح به.', code: 'VPN_DETECTED' };
 if (vpnResult.isProxy) throw { status: 403, message: 'AR متاح فقط للمستخدمين في الجزائر. البروكسي غير مسموح به.', code: 'PROXY_DETECTED' };
 if (vpnResult.isTor) throw { status: 403, message: 'شبكة Tor غير مسموح بها على AR.', code: 'TOR_DETECTED' };
 if (!vpnResult.isAlgeria && vpnResult.country !== 'UNKNOWN') {
 throw { status: 403, message: 'AR متاح فقط للمستخدمين داخل الجزائر', code: 'NOT_ALGERIA' };
 }
 }

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

 // تسجيل/تحديث الجهاز أولاً (بانتظار النتيجة) باش ناخذ deviceId
 // ونربطه بالتوكن من ساعة توليده — بلا هذا ما نقدروش نربطو الجلسة
 // بجهاز معيّن للإبطال الفوري لاحقاً (سجل خروج من جهاز واحد)
 let deviceId = null;
 if (req.headers) {
 const { registerDeviceOnLogin } = require('./device.service');
 try {
 const deviceResult = await registerDeviceOnLogin(user.id, req, null);
 deviceId = deviceResult.deviceId;
 } catch (e) {
 logger.error('فشل تسجيل الجهاز عند الدخول:', e);
 }
 }

 const { accessToken, refreshToken } = generateTokens(user.id, {
 tokenVersion: user.token_version || 0,
 deviceId,
 });

 if (deviceId) {
 await query(`UPDATE sessions_devices SET access_token = $1 WHERE id = $2`, [accessToken, deviceId]);
 }

 await query(
 `INSERT INTO security_logs (user_id, ip_address, event_type, severity)
 VALUES ($1, $2, 'login_success', 'info')`,
 [user.id, ip]
 );

 // إلغاء طلب حذف الحساب تلقائياً إذا كان قائماً
 const { cancelDeletionIfExists } = require('../users/accountDeletion.service');
 cancelDeletionIfExists(user.id).catch((e) => logger.error(e));

 const { password_hash, ...userWithoutPassword } = user;
 return { user: userWithoutPassword, accessToken, refreshToken };
}

// ─── تسجيل الخروج ─────────────────────────────────────────────
// refreshToken اختياري بالبارامتر: لو انبعث، يتبلاكليست أيضاً —
// وإلا يبقى صالح لغاية 30 يوم حتى بعد "تسجيل الخروج" (ثغرة كانت
// موجودة سابقاً بجانب الأدمن أيضاً، راجع admin.auth.routes.js)
async function logout(token, userId, refreshToken = null) {
 await blacklistToken(token, 7 * 24 * 60 * 60); // 7 أيام (أقصى عمر access token)

 if (refreshToken) {
 try {
 const decoded = jwt.decode(refreshToken);
 const remaining = decoded?.exp ? Math.max(decoded.exp - Math.floor(Date.now() / 1000), 60) : 30 * 24 * 60 * 60;
 await blacklistToken(refreshToken, remaining);
 } catch (e) {
 logger.error('فشل بلاكليست refresh token عند logout:', e);
 }
 }

 await query(
 `INSERT INTO security_logs (user_id, event_type, severity)
 VALUES ($1, 'logout', 'info')`,
 [userId]
 );
}

// ─── تجديد الـ Token ───────────────────────────────────────────
// تحقق كامل + rotation: التوكن القديم يتبطّل فوراً بعد إصدار الجديد،
// بلا هذا كان أي refresh token مسروق يبقى صالح 30 يوم بلا أي طريقة
// نلغيه (نفس ثغرة الأدمن المذكورة بالمراجعة السابقة).
async function refreshAccessToken(refreshToken) {
 const { isTokenBlacklisted } = require('../../config/redis');
 let decoded;
 try {
 decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
 } catch {
 throw { status: 401, message: 'رمز التجديد غير صالح', code: 'INVALID_REFRESH' };
 }

 if (await isTokenBlacklisted(refreshToken)) {
 throw { status: 401, message: 'رمز التجديد مُبطَل، سجل دخولك مجدداً', code: 'REFRESH_REVOKED' };
 }

 const result = await query(
 `SELECT id, is_banned, token_version FROM users WHERE id = $1`,
 [decoded.userId]
 );
 const user = result.rows[0];
 if (!user) {
 throw { status: 401, message: 'المستخدم غير موجود', code: 'USER_NOT_FOUND' };
 }
 if (user.is_banned) {
 throw { status: 403, message: 'حسابك موقوف', code: 'ACCOUNT_BANNED' };
 }
 if ((decoded.tv || 0) !== (user.token_version || 0)) {
 throw { status: 401, message: 'الجلسة أُبطلت، سجل دخولك مجدداً', code: 'TOKEN_VERSION_MISMATCH' };
 }

 if (decoded.did) {
 const deviceCheck = await query(
 `SELECT revoked_at FROM sessions_devices WHERE id = $1 AND user_id = $2`,
 [decoded.did, user.id]
 );
 if (deviceCheck.rows.length === 0 || deviceCheck.rows[0].revoked_at) {
 throw { status: 401, message: 'تم إبطال هذه الجلسة من هذا الجهاز', code: 'SESSION_REVOKED' };
 }
 }

 // rotation: نبطّل التوكن القديم فوراً بعد ما نصدر الجديد
 const remaining = decoded.exp ? Math.max(decoded.exp - Math.floor(Date.now() / 1000), 60) : 30 * 24 * 60 * 60;
 await blacklistToken(refreshToken, remaining);

 const tokens = generateTokens(user.id, { tokenVersion: user.token_version || 0, deviceId: decoded.did || null });

 if (decoded.did) {
 await query(`UPDATE sessions_devices SET access_token = $1 WHERE id = $2`, [tokens.accessToken, decoded.did]);
 }

 return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

module.exports = {
 sendOTP, verifyOTP, register,
 login, logout, refreshAccessToken,
};
