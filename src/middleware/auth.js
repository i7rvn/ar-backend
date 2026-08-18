const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { isTokenBlacklisted } = require('../config/redis');
const { query } = require('../config/database');

async function authenticate(req, res, next) {
 try {
 const authHeader = req.headers.authorization;
 if (!authHeader?.startsWith('Bearer ')) {
 return res.status(401).json({
 success: false,
 message: 'يجب تسجيل الدخول أولاً',
 code: 'NO_TOKEN',
 });
 }

 const token = authHeader.split(' ')[1];

 // تحقق من القائمة السوداء
 const blacklisted = await isTokenBlacklisted(token);
 if (blacklisted) {
 return res.status(401).json({
 success: false,
 message: 'انتهت صلاحية الجلسة، سجل دخولك مجدداً',
 code: 'TOKEN_REVOKED',
 });
 }

 // التحقق من الـ token
 const decoded = jwt.verify(token, process.env.JWT_SECRET);

 // جلب المستخدم من القاعدة
 const result = await query(
 `SELECT id, email, username, display_name, avatar_url,
 is_verified, is_admin, is_banned
 FROM users WHERE id = $1`,
 [decoded.userId]
 );

 if (result.rows.length === 0) {
 return res.status(401).json({
 success: false,
 message: 'المستخدم غير موجود',
 code: 'USER_NOT_FOUND',
 });
 }

 const user = result.rows[0];

 if (user.is_banned) {
 return res.status(403).json({
 success: false,
 message: 'حسابك موقوف',
 code: 'ACCOUNT_BANNED',
 });
 }

 req.user = user;
 req.token = token;
 next();
 } catch (err) {
 if (err.name === 'TokenExpiredError') {
 return res.status(401).json({
 success: false,
 message: 'انتهت صلاحية الجلسة',
 code: 'TOKEN_EXPIRED',
 });
 }
 logger.error('خطأ في المصادقة:', err);
 return res.status(401).json({
 success: false,
 message: 'جلسة غير صالحة',
 code: 'INVALID_TOKEN',
 });
 }
}

// middleware للأدمن فقط
async function requireAdmin(req, res, next) {
 await authenticate(req, res, async () => {
 if (!req.user?.is_admin) {
 return res.status(403).json({
 success: false,
 message: 'غير مسموح. صلاحيات الأدمن مطلوبة.',
 code: 'FORBIDDEN',
 });
 }
 next();
 });
}

module.exports = { authenticate, requireAdmin };
