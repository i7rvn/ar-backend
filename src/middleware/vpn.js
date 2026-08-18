const axios = require('axios');
const logger = require('../config/logger');
const { query } = require('../config/database');
const { setVPNResult, getVPNResult } = require('../config/redis');

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

// ─── Middleware الرئيسي ───────────────────────────────────────
async function vpnGuard(req, res, next) {
 const ip = getClientIP(req);

 // تجاوز الـ IPs المحلية (للتطوير)
 if (isPrivateIP(ip) || process.env.NODE_ENV === 'development') {
 return next();
 }

 try {
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

module.exports = { vpnGuard, getClientIP };
