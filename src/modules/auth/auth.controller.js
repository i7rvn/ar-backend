const authService = require('./auth.service');
const logger = require('../../config/logger');
const { getClientIP } = require('../../middleware/vpn');
const { recordFailedAttempt, clearFailedAttempts } = require('../../middleware/accountLock');

// ─── إرسال OTP ────────────────────────────────────────────────
async function sendOTP(req, res) {
  try {
    const { email, phone, channel = 'email' } = req.body;
    const identifier = channel === 'whatsapp' ? phone : email;
    await authService.sendOTP(identifier, channel);
    res.json({
      success: true,
      message: channel === 'whatsapp' ? 'تم إرسال رمز التحقق عبر واتساب' : 'تم إرسال رمز التحقق إلى بريدك الإلكتروني',
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }
}

// ─── التحقق من OTP ────────────────────────────────────────────
async function verifyOTP(req, res) {
  try {
    const { email, phone, code, channel = 'email' } = req.body;
    const identifier = channel === 'whatsapp' ? phone : email;
    await authService.verifyOTP(identifier, code, channel);
    res.json({
      success: true,
      message: channel === 'whatsapp' ? 'تم التحقق من رقم الهاتف بنجاح' : 'تم التحقق من البريد الإلكتروني بنجاح',
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }
}

// ─── التسجيل ──────────────────────────────────────────────────
async function register(req, res) {
  try {
    const { user, accessToken, refreshToken } = await authService.register(req.body, req);
    res.status(201).json({
      success: true,
      message: 'تم إنشاء حسابك بنجاح، مرحباً بك في AR',
      data: { user, accessToken, refreshToken },
    });
  } catch (err) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }
}

// ─── تسجيل الدخول ─────────────────────────────────────────────
async function login(req, res) {
  try {
    const ip = getClientIP(req);
    const { user, accessToken, refreshToken } = await authService.login(req.body, ip, req);
    if (req.lockKey) await clearFailedAttempts(req.lockKey);
    res.json({
      success: true,
      message: `مرحباً بعودتك يا ${user.display_name}`,
      data: { user, accessToken, refreshToken },
    });
  } catch (err) {
    if (err.code === 'TOTP_REQUIRED') {
      return res.status(428).json({ success: false, requiresTOTP: true, code: 'TOTP_REQUIRED', message: err.message });
    }
    if (req.lockKey && err.code === 'INVALID_CREDENTIALS') {
      await recordFailedAttempt(req.lockKey);
    }
    res.status(err.status || 500).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }
}

// ─── تسجيل الخروج ─────────────────────────────────────────────
async function logout(req, res) {
 try {
 // refreshToken اختياري بالـ body — لو انبعث يتبلاكليست هو الآخر
 await authService.logout(req.token, req.user.id, req.body?.refreshToken || null);
 res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
 } catch (err) {
 res.status(500).json({ success: false, message: err.message });
 }
}

// ─── تجديد الـ Token ───────────────────────────────────────────
async function refreshToken(req, res) {
 try {
 const { refreshToken } = req.body;
 if (!refreshToken) {
 return res.status(400).json({ success: false, message: 'رمز التجديد مطلوب' });
 }
 // الآن ترجّع accessToken جديد + refreshToken جديد أيضاً (rotation) —
 // القديم يتبطّل تلقائياً داخل authService.refreshAccessToken
 const { accessToken, refreshToken: newRefreshToken } = await authService.refreshAccessToken(refreshToken);
 res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
 } catch (err) {
 res.status(err.status || 500).json({ success: false, message: err.message });
 }
}

// ─── مبادلة كود Impersonation لمرة وحدة بالتوكن الحقيقي ─────────
// الكود يتولّد من dashboardUsers.routes.js (impersonate)، يعيش 30
// ثانية بـ Redis، ويُحذف فور أول استعمال (GETDEL) — بلا هذا، لو
// حد اعترض الرابط بهاذي الفترة القصيرة يقدر يستعمل الكود مرتين
async function exchangeImpersonationCode(req, res) {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: 'الكود مطلوب' });
    }
    const { client: redisClient } = require('../../config/redis');
    const key = `impersonation_code:${code}`;
    // GETDEL ذري: يقرأ ويحذف بعملية واحدة، يمنع استعمال نفس الكود مرتين
    // بطلبين متزامنين (Redis >= 6.2). لو النسخة أقدم، fallback يدوي تحت.
    let accessToken;
    if (typeof redisClient.getDel === 'function') {
      accessToken = await redisClient.getDel(key);
    } else {
      accessToken = await redisClient.get(key);
      if (accessToken) await redisClient.del(key);
    }
    if (!accessToken) {
      return res.status(401).json({ success: false, message: 'الكود منتهي أو مستعمل من قبل', code: 'CODE_EXPIRED' });
    }
    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    logger.error('خطأ exchangeImpersonationCode:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
}

// ─── معلومات المستخدم الحالي ──────────────────────────────────
async function me(req, res) {
 res.json({ success: true, data: { user: req.user } });
}

// ─── طلب إعادة تعيين كلمة المرور (نسيت كلمة المرور) ────────────
async function forgotPassword(req, res) {
 try {
 const { email } = req.body;
 if (!email) {
 return res.status(400).json({ success: false, message: 'البريد الإلكتروني مطلوب' });
 }
 const { requestPasswordReset } = require('./recovery.service');
 await requestPasswordReset(email);
 // رسالة موحّدة دائماً، بلا كشف إن كان البريد مسجّلاً أم لا
 res.json({ success: true, message: 'إذا كان بريدك مسجّلاً، ستصلك رسالة لإعادة تعيين كلمة المرور' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'حدث خطأ، حاول مرة أخرى لاحقاً' });
 }
}

// ─── تنفيذ إعادة تعيين كلمة المرور بالتوكن المُرسَل بالبريد ─────
async function resetPassword(req, res) {
 try {
 const { token, newPassword } = req.body;
 if (!token || !newPassword) {
 return res.status(400).json({ success: false, message: 'الرمز وكلمة المرور الجديدة مطلوبان' });
 }
 const { resetPasswordWithToken } = require('./recovery.service');
 const result = await resetPasswordWithToken(token, newPassword);
 if (!result.success) {
 return res.status(400).json({ success: false, message: result.reason });
 }
 res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح، يمكنك الآن تسجيل الدخول' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'حدث خطأ، حاول مرة أخرى لاحقاً' });
 }
}

// ─── فحص قوة كلمة المرور حياً (بلا أي تسجيل) ─────────────────────
async function checkPasswordStrength(req, res) {
 try {
 const { password, email, username, displayName } = req.body;
 if (!password) {
 return res.status(400).json({ success: false, message: 'كلمة المرور مطلوبة' });
 }
 const { checkPasswordStrength: check } = require('../../utils/zxcvbn');
 const result = check(password, [email, username, displayName].filter(Boolean));
 res.json({ success: true, ...result });
 } catch (err) {
 res.status(500).json({ success: false, message: 'حدث خطأ' });
 }
}

module.exports = { sendOTP, verifyOTP, register, login, logout, refreshToken, me, forgotPassword, resetPassword, checkPasswordStrength, exchangeImpersonationCode };
