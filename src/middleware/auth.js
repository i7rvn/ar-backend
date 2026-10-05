const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { isTokenBlacklisted } = require('../config/redis');
const { query } = require('../config/database');

function authError(status, message, code) {
  return { status, message, code };
}

async function authenticateAccessToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw authError(401, 'يجب تسجيل الدخول أولاً', 'NO_TOKEN');
  }

  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    throw authError(401, 'انتهت صلاحية الجلسة، سجل دخولك مجدداً', 'TOKEN_REVOKED');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw authError(401, 'انتهت صلاحية الجلسة', 'TOKEN_EXPIRED');
    }
    throw authError(401, 'جلسة غير صالحة', 'INVALID_TOKEN');
  }

  if (!decoded?.userId) {
    throw authError(401, 'جلسة غير صالحة', 'INVALID_TOKEN');
  }

  const result = await query(
    `SELECT id, email, username, display_name, avatar_url,
      is_verified, is_admin, is_banned, token_version
     FROM users WHERE id = $1`,
    [decoded.userId]
  );

  if (result.rows.length === 0) {
    throw authError(401, 'المستخدم غير موجود', 'USER_NOT_FOUND');
  }

  const user = result.rows[0];

  if (user.is_banned) {
    throw authError(403, 'حسابك موقوف', 'ACCOUNT_BANNED');
  }

  if ((decoded.tv || 0) !== (user.token_version || 0)) {
    throw authError(401, 'انتهت صلاحية الجلسة، سجل دخولك مجدداً', 'TOKEN_VERSION_MISMATCH');
  }

  if (decoded.did) {
    const deviceCheck = await query(
      `SELECT revoked_at
       FROM sessions_devices
       WHERE id = $1 AND user_id = $2`,
      [decoded.did, user.id]
    );

    if (deviceCheck.rows.length === 0 || deviceCheck.rows[0].revoked_at) {
      throw authError(401, 'تم تسجيل الخروج من هذا الجهاز', 'SESSION_REVOKED');
    }
  }

  return {
    user,
    token,
    deviceId: decoded.did || null,
    decoded,
  };
}

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

    const token = authHeader.slice(7).trim();
    const session = await authenticateAccessToken(token);

    req.user = session.user;
    req.token = session.token;
    req.deviceId = session.deviceId;
    req.auth = session.decoded;
    next();
  } catch (err) {
    logger.error('خطأ في المصادقة:', err);
    return res.status(err.status || 401).json({
      success: false,
      message: err.message || 'جلسة غير صالحة',
      code: err.code || 'INVALID_TOKEN',
    });
  }
}

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

module.exports = { authenticate, authenticateAccessToken, requireAdmin };
