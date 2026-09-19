const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { query } = require('../config/database');
const { isTokenBlacklisted } = require('../config/redis');

// مصادقة الأدمن — منفصلة عن مصادقة المستخدم العادي، تتحقق من جدول admins
async function adminAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'دخول أدمن مطلوب', code: 'NO_TOKEN' });
    }

    const token = authHeader.split(' ')[1];
    if (await isTokenBlacklisted(token)) {
      return res.status(401).json({ success: false, message: 'انتهت الجلسة', code: 'TOKEN_REVOKED' });
    }

    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET);
    if (!decoded.adminId) {
      return res.status(403).json({ success: false, message: 'توكن ماشي توكن أدمن', code: 'NOT_ADMIN_TOKEN' });
    }

    const result = await query(
      `SELECT a.id, a.user_id, a.is_owner, a.role_id, a.totp_required, a.token_version,
              r.name AS role_name, u.is_banned
       FROM admins a
       LEFT JOIN roles r ON r.id = a.role_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [decoded.adminId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'حساب الأدمن غير موجود', code: 'ADMIN_NOT_FOUND' });
    }

    const admin = result.rows[0];

    // حساب المستخدم المرتبط بالأدمن محظور -> يقطع الوصول للوحة فوراً
    if (admin.is_banned) {
      return res.status(403).json({ success: false, message: 'حساب الأدمن موقوف', code: 'ADMIN_BANNED' });
    }

    // token_version: يبطّل كل جلسات الأدمن دفعة وحدة عند الحاجة
    // (مثلاً الشك بتسريب، أو تغيير كلمة سر الأدمن)
    if ((decoded.tv || 0) !== (admin.token_version || 0)) {
      return res.status(401).json({ success: false, message: 'انتهت الجلسة، سجل دخولك مجدداً', code: 'TOKEN_VERSION_MISMATCH' });
    }

    req.admin = admin;
    req.adminToken = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'انتهت الجلسة', code: 'TOKEN_EXPIRED' });
    }
    logger.error('خطأ adminAuth:', err);
    return res.status(401).json({ success: false, message: 'جلسة أدمن غير صالحة', code: 'INVALID_TOKEN' });
  }
}

module.exports = { adminAuthenticate };
