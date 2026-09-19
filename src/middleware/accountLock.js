const { client: redis } = require('../config/redis');
const { getSetting } = require('../config/settings');

// قفل تدريجي: يزيد وقت الانتظار مع كل محاولة فاشلة (بدل قفل ثابت)
// المفتاح مبني على البريد + IP لتفادي حجب مستخدم بسبب هجوم من جهاز آخر
async function checkAccountLock(req, res, next) {
  const identifier = req.body?.identifier || req.ip;
  const key = `lock:${identifier}`;

  const attempts = parseInt(await redis.get(key)) || 0;
  const maxAttempts = parseInt(await getSetting('account_lock_attempts', 5));

  if (attempts >= maxAttempts) {
    const ttl = await redis.ttl(key);
    return res.status(423).json({
      success: false,
      message: `حسابك مقفل مؤقتاً، حاول بعد ${Math.ceil(ttl / 60)} دقيقة`,
      code: 'ACCOUNT_LOCKED',
      retryAfterSeconds: ttl,
    });
  }
  req.lockKey = key;
  next();
}

// تُستدعى بعد محاولة دخول فاشلة
async function recordFailedAttempt(lockKey) {
 const attempts = await redis.incr(lockKey);
 const lockMinutes = parseInt(await getSetting('account_lock_minutes', 15));
 // كل محاولة تزيد مدة القفل تدريجياً: المحاولة الأولى وقت قصير، والمتكررة توقيت أطول
 const progressiveTTL = Math.min(attempts * lockMinutes * 60, 24 * 3600);
 await redis.expire(lockKey, progressiveTTL);
 return attempts;
}

// تُستدعى بعد دخول ناجح لتصفير العداد
async function clearFailedAttempts(lockKey) {
 await redis.del(lockKey);
}

module.exports = { checkAccountLock, recordFailedAttempt, clearFailedAttempts };
