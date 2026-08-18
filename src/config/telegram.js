// ═══════════════════════════════════════════════════════════════
// AR App — بوت تنبيهات تيليجرام موحّد، بفلترة ذكية
//
// لا تُرسَل كل رسالة تصل لهذه الدالة فعلياً. "info"لا تُرسَل إطلاقاً
// (تبقى بسجلات النظام فقط)، و"warning"تُرسَل مع تجميع تكرارات
// نفس الرسالة خلال فترة قصيرة بدل إرسالها كل مرة، و"critical"تُرسَل
// فوراً دائماً.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');
const axios = require('axios');
const logger = require('./logger');
const { client: redisClient } = require('./redis');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WARNING_DEDUPE_SECONDS = 600;

async function shouldSendWarning(message) {
  const hash = crypto.createHash('sha256').update(message).digest('hex');
  const key = `telegram_dedupe:${hash}`;
  const alreadySent = await redisClient.get(key);
  if (alreadySent) return false;
  await redisClient.setEx(key, WARNING_DEDUPE_SECONDS, '1');
  return true;
}

async function sendAlert(message, level = 'info') {
  if (level === 'info') return;
  if (!BOT_TOKEN || !CHAT_ID) return;

  if (level === 'warning') {
    const shouldSend = await shouldSendWarning(message).catch(() => true);
    if (!shouldSend) return;
  }

  const label = level === 'critical' ? 'خطأ حرج' : 'تنبيه';
  const text = `AR App - ${label}\n${message}`;

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
    });
  } catch (err) {
    logger.error('فشل إرسال تنبيه تيليجرام:', err.message);
  }
}

module.exports = { sendAlert };
