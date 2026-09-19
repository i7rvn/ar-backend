// ═══════════════════════════════════════════════════════════════
// إرسال OTP عبر واتساب — Twilio (Content API، قالب معتمد من Meta)
//
// شرط أساسي قبل التشغيل: لازم قالب رسالة (Template) معتمد من Meta
// عبر Twilio Console → Messaging → Content Template Builder:
//   Category: Authentication
//   المتن: "رمز التحقق الخاص بك في AR هو {{1}}. صالح لمدة 10 دقائق."
// الموافقة على قوالب Authentication عادةً خلال ساعات، أسرع بكثير
// من قوالب Marketing. بعد الموافقة، انسخ الـ Content SID (يبدأ
// بـ HX...) لمتغير TWILIO_OTP_CONTENT_SID تحت.
//
// ليش قالب إجباري (ماشي رسالة نصية حرة): OTP هو أول تواصل من طرفك
// مع المستخدم (business-initiated، بره نافذة الـ24 ساعة من أي رسالة
// سابقة منه) — سياسة Meta تفرض قالب معتمد بهذي الحالة، الرسائل
// الحرة تُرفض تلقائياً بره وضع Sandbox.
// ═══════════════════════════════════════════════════════════════

const axios = require('axios');
const logger = require('./logger');

async function sendOTPWhatsApp(phone, otp) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, TWILIO_OTP_CONTENT_SID } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !TWILIO_OTP_CONTENT_SID) {
    throw new Error('إعدادات Twilio (WhatsApp) غير مكتملة بمتغيرات البيئة');
  }

  // الصيغة الدولية إجبارية (whatsapp:+213...)
  const to = phone.startsWith('whatsapp:') ? phone : `whatsapp:${phone}`;
  const from = TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? TWILIO_WHATSAPP_FROM : `whatsapp:${TWILIO_WHATSAPP_FROM}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const params = new URLSearchParams();
  params.append('To', to);
  params.append('From', from);
  params.append('ContentSid', TWILIO_OTP_CONTENT_SID);
  // {{1}} بالقالب = الكود هنا
  params.append('ContentVariables', JSON.stringify({ 1: otp }));

  try {
    await axios.post(url, params, {
      auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN },
      timeout: 8000,
    });
    logger.info(`OTP أُرسل عبر واتساب إلى ${phone}`);
    return true;
  } catch (err) {
    logger.error(`فشل إرسال OTP عبر واتساب إلى ${phone}:`, err.response?.data || err.message);
    throw new Error('فشل إرسال رمز التحقق عبر واتساب');
  }
}

module.exports = { sendOTPWhatsApp };
