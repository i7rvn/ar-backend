// ═══════════════════════════════════════════════════════════════
// AR App — تسجيل مُشغِّلي الطوابير (Queue Workers) عند إقلاع التطبيق
// ═══════════════════════════════════════════════════════════════

const { startWorker, startDelayedJobsPoller, registerQueue, enqueue } = require('./queue');
const { client: redisClient } = require('./redis');
const { sendOTPEmail, sendWelcomeEmail, sendEmail } = require('./email');
const logger = require('./logger');

function startQueueWorkers() {
  registerQueue('otp-retry');
  registerQueue('generic-emails');

  // بريد ترحيب أو تنبيه جهاز جديد — غير حرجة، لكن نضمن إعادة محاولتها
  // تلقائياً بدل إسقاطها بصمت عند أي فشل عابر بخادم البريد
  startWorker('generic-emails', async (payload) => {
    if (payload.type === 'welcome') {
      await sendWelcomeEmail(payload.email, payload.displayName, payload.meta);
    } else if (payload.type === 'raw-email') {
      await sendEmail(payload.email, payload.subject, payload.text);
    }
  }, { baseDelaySeconds: 60, maxRetries: 5 });

  // إعادة محاولة إرسال OTP بعد فشل الإرسال المباشر
  // يتحقق من رمز التسلسل قبل الإرسال حتى لا يرسل كوداً تجاوزه طلب أحدث
  startWorker('otp-retry', async (payload) => {
    const currentToken = await redisClient.get(`otp_token:${payload.email}`);
    if (parseInt(currentToken, 10) !== payload.token) {
      logger.info(`إعادة محاولة OTP لـ ${payload.email} أُلغيت، يوجد طلب أحدث`);
      return;
    }

    const currentOtp = await redisClient.get(`otp:${payload.email}`);
    if (!currentOtp) {
      logger.info(`إعادة محاولة OTP لـ ${payload.email} أُلغيت، الكود منتهي الصلاحية`);
      return;
    }

    await sendOTPEmail(payload.email, currentOtp);
    logger.info(`نجحت إعادة إرسال OTP لـ ${payload.email} بعد إعادة المحاولة`);
  }, { baseDelaySeconds: 30, maxRetries: 8 });

  startDelayedJobsPoller();
  logger.info('مُشغِّلو الطوابير بدأوا العمل');
}

module.exports = { startQueueWorkers };
