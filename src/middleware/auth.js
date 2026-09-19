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

    // جلب المستخدم من القاعدة (token_version للإبطال الفوري الشامل)
    const result = await query(
      `SELECT id, email, username, display_name, avatar_url,
      is_verified, is_admin, is_banned, token_version
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

    // token_version: لو تغيّر (تغيير كلمة سر، حظر، "إبطال كل الأجهزة")
    // بعد إصدار هذا التوكن، يُرفض فوراً بلا انتظار انتهاء صلاحيته الطبيعية
    if ((decoded.tv || 0) !== (user.token_version || 0)) {
      return res.status(401).json({
        success: false,
        message: 'انتهت صلاحية الجلسة، سجل دخولك مجدداً',
        code: 'TOKEN_VERSION_MISMATCH',
      });
    }

    // ربط الجهاز: لو التوكن مرتبط بجلسة جهاز مُبطلة (تسجيل خروج عن
    // بُعد من هذا الجهاز بالذات)، يُرفض حتى لو التوكن نفسه لسه صالح
    if (decoded.did) {
      const deviceCheck = await query(
        `SELECT revoked_at FROM sessions_devices WHERE id = $1 AND user_id = $2`,
        [decoded.did, user.id]
      );
      if (deviceCheck.rows.length === 0 || deviceCheck.rows[0].revoked_at) {
        return res.status(401).json({
          success: false,
          message: 'تم تسجيل الخروج من هذا الجهاز',
          code: 'SESSION_REVOKED',
        });
      }
    }

    req.user = user;
    req.token = token;
    req.deviceId = decoded.did || null;
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
