// ═══════════════════════════════════════════════════════════════
// إرسال البريد الإلكتروني عبر Resend (HTTP API) — أبداً SMTP.
//
// السبب: هذا كان مذكوراً صراحة بالمواصفة الأصلية للمشروع، وتأكد
// فعلياً بالإنتاج: Gmail SMTP من سيرفرات cloud (Render وغيرها)
// يفشل بـ"Connection timeout" لأن Google تحجب/تبطّئ الاتصالات من
// نطاقات IP معروفة كـ"سحابية" بشكل مقصود لمكافحة السبام. مهلة
// الاتصال SMTP الفاشلة (10-30+ ثانية) كانت سبب التأخير الكبير قبل
// وصول رد /auth/send-otp للمستخدم، وأحياناً كان يفشل نهائياً بعد
// إعادة المحاولة عبر الطابور (نفس المشكلة، نفس السيرفر يحاول SMTP).
//
// Resend يشتغل بطلب HTTP عادي (POST بسيط، رد خلال أجزاء من الثانية،
// بلا مصافحة SMTP معقدة) — يحل المشكلتين معاً: البطء والفشل الصامت.
//
// الإعداد المطلوب:
//   1. أنشئ حساب مجاني بـ https://resend.com (بلا بطاقة بنكية،
//      100 إيميل/يوم مجاناً — كافي جداً لمرحلة الإطلاق)
//   2. أضف نطاقك (Domain) وتحقق منه عبر سجلات DNS، أو استعمل مؤقتاً
//      onboarding@resend.dev كـ EMAIL_FROM للتجربة (يرسل فقط
//      للإيميل المسجَّل بحسابك بـ Resend، غير كافٍ لمستخدمين حقيقيين)
//   3. RESEND_API_KEY بمتغيرات البيئة بـ Render (بديل EMAIL_HOST/
//      EMAIL_PORT/EMAIL_USER/EMAIL_PASSWORD القديمة بالكامل)
//   4. EMAIL_FROM يجب يكون بنطاقك الموثَّق (مثلاً no-reply@ar-app.dz)
// ═══════════════════════════════════════════════════════════════

const axios = require('axios');
const logger = require('./logger');

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendViaResend({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY غير مضبوط بمتغيرات البيئة');
  }

  const payload = {
    from: process.env.EMAIL_FROM || 'AR App <onboarding@resend.dev>',
    to: [to],
    subject,
  };
  if (html) payload.html = html;
  if (text) payload.text = text;

  // مهلة قصيرة عمداً (Resend HTTP API سريع جداً عادةً) — لو تجاوزها
  // شيء غير طبيعي (شبكة، لا مصافحة SMTP بطيئة تبرر مهلة طويلة هنا)
  await axios.post(RESEND_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 8000,
  });
}

async function sendOTPEmail(email, otp) {
  const html = `
  <!DOCTYPE html>
  <html dir="rtl" lang="ar">
  <head>
  <meta charset="UTF-8"/>
  <style>
  body { font-family: 'Cairo', Arial, sans-serif; background:#0a0a0f; margin:0; padding:20px; }
  .card { max-width:480px; margin:0 auto; background:#111118; border-radius:16px;
  border:1px solid rgba(255,255,255,.1); overflow:hidden; }
  .header { background:linear-gradient(135deg,#003d1a,#001a0a); padding:32px; text-align:center; }
  .logo { font-size:48px; font-weight:900; color:#00C853; letter-spacing:-2px; }
  .body { padding:32px; }
  .title { color:#f0f0f5; font-size:20px; font-weight:700; margin-bottom:8px; }
  .sub { color:#8888aa; font-size:14px; margin-bottom:28px; }
  .otp-box { background:rgba(0,200,83,.08); border:2px solid rgba(0,200,83,.3);
  border-radius:12px; padding:24px; text-align:center; margin-bottom:24px; }
  .otp { font-size:42px; font-weight:900; color:#00C853; letter-spacing:10px;
  font-family:monospace; }
  .expire { color:#8888aa; font-size:13px; margin-top:8px; }
  .warning { background:rgba(255,171,0,.06); border:1px solid rgba(255,171,0,.2);
  border-radius:8px; padding:14px; color:#ffab00; font-size:13px; }
  .footer { padding:20px 32px; border-top:1px solid rgba(255,255,255,.08);
  color:#555577; font-size:12px; text-align:center; }
  </style>
  </head>
  <body>
  <div class="card">
  <div class="header">
  <div class="logo">AR</div>
  <div style="color:#8888aa;font-size:13px;margin-top:6px;">الشبكة الاجتماعية الجزائرية</div>
  </div>
  <div class="body">
  <div class="title">رمز التحقق الخاص بك</div>
  <div class="sub">استخدم هذا الرمز لتأكيد بريدك الإلكتروني</div>
  <div class="otp-box">
  <div class="otp">${otp}</div>
  <div class="expire">صالح لمدة 10 دقائق فقط</div>
  </div>
  <div class="warning">
  لا تشارك هذا الرمز مع أي شخص. AR لن تطلب منك هذا الرمز أبداً.
  </div>
  </div>
  <div class="footer">
  إذا لم تطلب هذا الرمز، تجاهل هذا البريد الإلكتروني.<br/>
  © 2026 AR App - الجزائر
  </div>
  </div>
  </body>
  </html>`;

  try {
    await sendViaResend({ to: email, subject: `${otp} — رمز التحقق لـ AR`, html });
    logger.info(`OTP أُرسل إلى ${email} عبر Resend`);
    return true;
  } catch (err) {
    logger.error(`فشل إرسال OTP إلى ${email}:`, err.response?.data || err.message);
    throw new Error('فشل إرسال البريد الإلكتروني');
  }
}

async function sendWelcomeEmail(email, displayName, meta = {}) {
  const { ip, userAgent, createdAt } = meta;
  const when = createdAt ? new Date(createdAt).toLocaleString('ar-DZ') : new Date().toLocaleString('ar-DZ');

  const html = `
  <!DOCTYPE html>
  <html dir="rtl" lang="ar">
  <head><meta charset="UTF-8"/></head>
  <body style="font-family:Arial,sans-serif;background:#0a0a0f;color:#f0f0f5;padding:20px;">
  <div style="max-width:480px;margin:0 auto;background:#111118;border-radius:16px;
  border:1px solid rgba(255,255,255,.1);padding:32px;text-align:center;">
  <div style="font-size:48px;font-weight:900;color:#00C853;">AR</div>
  <h2>مرحباً بك يا ${displayName}</h2>
  <p style="color:#8888aa;">أنت الآن جزء من الشبكة الاجتماعية الجزائرية.</p>
  <p style="color:#8888aa;">شارك أفكارك، تابع أصدقاءك، وكن جزءاً من المجتمع الجزائري الرقمي.</p>
  <div style="margin-top:20px;padding:16px;background:#1a1a24;border-radius:10px;text-align:right;color:#8888aa;font-size:13px;">
  <p>تفاصيل إنشاء الحساب:</p>
  <p>الوقت: ${when}</p>
  ${ip ? `<p>عنوان IP: ${ip}</p>` : ''}
  ${userAgent ? `<p>الجهاز: ${userAgent}</p>` : ''}
  <p style="margin-top:8px;">إذا لم تكن أنت من أنشأ هذا الحساب، تواصل مع الدعم فوراً.</p>
  </div>
  <div style="margin-top:24px;color:#555577;font-size:12px;">
  AR App - الجزائر
  </div>
  </div>
  </body>
  </html>`;

  try {
    await sendViaResend({ to: email, subject: `مرحباً بك في AR يا ${displayName}`, html });
  } catch (err) {
    logger.error('فشل إرسال بريد الترحيب:', err.response?.data || err.message);
    throw err;
  }
}

// دالة عامة لإرسال إيميل نصي بسيط — مستخدمة بوحدات v3 الجديدة
// (جهاز جديد، إعادة تعيين كلمة مرور، طلب حذف حساب...) بدون التأثير على القوالب القديمة
async function sendEmail(to, subject, text) {
  try {
    await sendViaResend({ to, subject, text });
  } catch (err) {
    logger.error(`فشل إرسال إيميل إلى ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendOTPEmail, sendWelcomeEmail, sendEmail };
