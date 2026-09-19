const axios = require('axios');
const net = require('net');
const logger = require('../config/logger');
const { query } = require('../config/database');
const { setVPNResult, getVPNResult, setCache, getCache } = require('../config/redis');

// ─── الـ IPs المحلية نتجاوزها ──────────────────────────────────
const PRIVATE_IPS = [
 /^127\./,
 /^192\.168\./,
 /^10\./,
 /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
 /^::1$/,
 /^localhost$/,
];

function isPrivateIP(ip) {
 return PRIVATE_IPS.some(pattern => pattern.test(ip));
}

function getClientIP(req) {
 return (
 req.headers['cf-connecting-ip'] || // Cloudflare
 req.headers['x-real-ip'] ||
 req.headers['x-forwarded-for']?.split(',')[0].trim() ||
 req.socket.remoteAddress
 );
}

async function checkVPN(ip) {
 // فحص صيغة IP قبل بعثه لأي خدمة خارجية — الـ IP هنا مصدره هيدرز
 // (x-forwarded-for/x-real-ip) اللي العميل يقدر يتحكم بيها جزئياً
 // إذا الإعداد بلا trust proxy صحيح؛ صيغة غير صالحة = رفض مباشر
 // بلا استدعاء الخدمة الخارجية (يقلل استغلال محتمل + يوفّر الحصة)
 if (!ip || !net.isIP(ip)) {
 return { allowed: true, country: 'UNKNOWN', isAlgeria: true, invalidIP: true };
 }

 // تحقق من الـ Cache أولاً
 const cached = await getVPNResult(ip);
 if (cached) return cached;

 try {
 // vpnapi.io - مجاني (1000 طلب/يوم)
 const response = await axios.get(`https://vpnapi.io/api/${ip}`, {
 params: { key: process.env.VPNAPI_KEY },
 timeout: 3000,
 });

 const data = response.data;
 const result = {
 allowed: !data.security?.vpn && !data.security?.proxy && !data.security?.tor,
 isVPN: data.security?.vpn || false,
 isProxy: data.security?.proxy || false,
 isTor: data.security?.tor || false,
 country: data.location?.country_code || 'UNKNOWN',
 isAlgeria: data.location?.country_code === 'DZ',
 };

 await setVPNResult(ip, result);
 return result;
 } catch (err) {
 // إذا فشل الطلب، اسمح بالمرور (لا تحجب بسبب خطأ في الخدمة)
 logger.warn(`فشل فحص VPN لـ ${ip}: ${err.message}`);
 return { allowed: true, country: 'UNKNOWN', isAlgeria: true };
 }
}

async function logVPNBlock(ip, reason) {
 try {
 await query(
 `INSERT INTO vpn_logs (ip_address, reason) VALUES ($1, $2)`,
 [ip, reason]
 );
 } catch (err) {
 logger.error('فشل تسجيل VPN block:', err);
 }
}

// ─── فحص قائمة الحظر اليدوي (blocked_ips) — منفصل عن فحص VPN/Proxy
// التلقائي؛ هذا الجدول يغذّيه زر "حظر IP دائم" بالداشبورد ────────
async function isManuallyBlocked(ip) {
 const cacheKey = `manual_block:${ip}`;
 const cached = await getCache(cacheKey);
 if (cached !== null) return cached;

 const result = await query(
 `SELECT 1 FROM blocked_ips WHERE ip_address = $1 AND (blocked_until IS NULL OR blocked_until > NOW())`,
 [ip]
 );
 const blocked = result.rows.length > 0;
 await setCache(cacheKey, blocked, 30); // كاش قصير — أي حظر جديد يفعّل خلال 30 ثانية كحد أقصى
 return blocked;
}

// ─── Middleware الرئيسي ───────────────────────────────────────
async function vpnGuard(req, res, next) {
 const ip = getClientIP(req);

 // تجاوز الـ IPs المحلية (للتطوير)
 if (isPrivateIP(ip) || process.env.NODE_ENV === 'development') {
 return next();
 }

 // /auth/login و /auth/register يديروا الفحص بأنفسهم داخل الـ service
 // (auth.service.js) — لازم منطق خاص هنا: مستخدم عنده geo_exempt=true
 // يتجاوز الفحص كلياً، ومستخدم يسجّل بكود دعوة صالح يتجاوزه هو الآخر.
 // فحص الحظر اليدوي (isManuallyBlocked) يبقى دائماً مفعّل حتى لهذولا —
 // هذا يصير داخل auth.service.js نفسه، ماشي هنا.
 if (req.originalUrl.includes('/auth/login') || req.originalUrl.includes('/auth/register')) {
 return next();
 }

 try {
 if (await isManuallyBlocked(ip)) {
 return res.status(403).json({
 success: false,
 message: 'تم حظر هذا العنوان من الوصول للمنصة.',
 code: 'IP_BLOCKED',
 });
 }

 const result = await checkVPN(ip);

 // حجب VPN
 if (result.isVPN) {
 await logVPNBlock(ip, 'vpn');
 return res.status(403).json({
 success: false,
 message: 'AR متاح فقط للمستخدمين في الجزائر. VPN غير مسموح به.',
 code: 'VPN_DETECTED',
 });
 }

 // حجب Proxy
 if (result.isProxy) {
 await logVPNBlock(ip, 'proxy');
 return res.status(403).json({
 success: false,
 message: 'AR متاح فقط للمستخدمين في الجزائر. البروكسي غير مسموح به.',
 code: 'PROXY_DETECTED',
 });
 }

 // حجب Tor
 if (result.isTor) {
 await logVPNBlock(ip, 'tor');
 return res.status(403).json({
 success: false,
 message: 'شبكة Tor غير مسموح بها على AR.',
 code: 'TOR_DETECTED',
 });
 }

 // حجب خارج الجزائر
 if (!result.isAlgeria && result.country !== 'UNKNOWN') {
 await logVPNBlock(ip, 'not_algeria');
 return res.status(403).json({
 success: false,
 message: 'AR متاح فقط للمستخدمين داخل الجزائر ',
 code: 'NOT_ALGERIA',
 });
 }

 next();
 } catch (err) {
 logger.error('خطأ في vpnGuard:', err);
 next(); // في حالة الخطأ، اسمح بالمرور
 }
}

module.exports = { vpnGuard, getClientIP, checkVPN, isManuallyBlocked, logVPNBlock };
