// ═══════════════════════════════════════════════════════════════
// AR App — تشفير حقيقي لحقول محدَّدة (البريد الإلكتروني حالياً)
//
// ⚠️ قرار تصميمي صريح، ماشي تفصيل تقني: مفاتيح الأقسام الثلاثة
// (DECRYPT_CODE_WEB/ANDROID/IOS) محمّلة بذاكرة السيرفر بشكل دائم
// طول مدة التشغيل — ماشي فقط لما الأدمن يفتح قسم بالداشبورد. هذا
// إجباري: التطبيق يبعث إيميلات (OTP، تنبيه جهاز جديد، إعادة تعيين
// كلمة سر...) بشكل تلقائي بلا أي تدخل بشري، فيحتاج فك التشفير في
// أي وقت. معنى هذا عملياً:
//   • الحماية الحقيقية هنا: ضد تسريب قاعدة البيانات فقط (نسخة
//     احتياطية مسروقة، SQL injection، وصول قراءة فقط للقاعدة).
//   • ماشي حماية ضد اختراق كامل للسيرفر (من عندو وصول لمتغيرات
//     البيئة أو ذاكرة العملية يقدر يفك التشفير).
//   • فقدان كود قسم بعد هذا لا يعني فقدان بياناته نهائياً — لازم
//     يبقى الكود محفوظاً بمتغيرات البيئة دائماً باش يخدم السيرفر،
//     فهو ماشي "سر يُدخَل مرة ويُنسى" كيما تصوّرنا بداية النقاش.
// ═══════════════════════════════════════════════════════════════

const crypto = require('crypto');

const SECTIONS = ['web', 'android', 'ios'];
const SECTION_CODE_ENV = {
  web: 'DECRYPT_CODE_WEB',
  android: 'DECRYPT_CODE_ANDROID',
  ios: 'DECRYPT_CODE_IOS',
};

function getHashSecret() {
 const secret = process.env.EMAIL_HASH_SECRET;
 if (!secret) throw new Error('EMAIL_HASH_SECRET غير مضبوط؛ لا يجوز استخدام JWT_SECRET كبديل');
 return secret;
}

// ─── اشتقاق مفتاح AES-256 من كود القسم (مرة واحدة، بالذاكرة) ────
const keyCache = new Map();
function getSectionKey(section) {
  if (!SECTIONS.includes(section)) throw new Error(`قسم غير صالح: ${section}`);
  if (keyCache.has(section)) return keyCache.get(section);

  const code = process.env[SECTION_CODE_ENV[section]];
  if (!code) throw new Error(`الكود البيئي ${SECTION_CODE_ENV[section]} غير مضبوط`);

  const key = crypto.scryptSync(code, `ar-section-salt:${section}`, 32);
  keyCache.set(section, key);
  return key;
}

// ─── تشفير/فك تشفير حقل واحد (AES-256-GCM، IV عشوائي لكل عملية) ──
function encryptField(plaintext, section) {
  const key = getSectionKey(section);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: encrypted, iv, tag };
}

function decryptField({ enc, iv, tag }, section) {
  const key = getSectionKey(section);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
  return decrypted.toString('utf8');
}

// ─── Hash حتمي (HMAC) للبحث/المطابقة بلا فك تشفير — يُستعمل بتسجيل
// الدخول والتحقق من تكرار البريد، بمفتاح منفصل عن مفاتيح الأقسام
// (لو تسرّب هذا المفتاح وحده، ما يكفيش لفك تشفير أي بريد حقيقي) ──
function hashEmailForLookup(email) {
  return crypto.createHmac('sha256', getHashSecret()).update(email.trim().toLowerCase()).digest('hex');
}

module.exports = { SECTIONS, encryptField, decryptField, hashEmailForLookup };
