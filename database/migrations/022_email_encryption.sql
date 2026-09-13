-- ═══════════════════════════════════════════════════════════════
-- Migration 021 : تشفير حقيقي لحقل البريد الإلكتروني (3 أقسام)
--
-- ⚠️ هذه Migration تضيف الأعمدة الجديدة فقط. تحويل البيانات
-- الموجودة فعلياً (تشفير كل بريد قديم) يتم عبر سكريبت منفصل
-- (scripts/encrypt-existing-emails.js) يُشغَّل مرة واحدة يدوياً
-- بعد ضبط DECRYPT_CODE_WEB/ANDROID/IOS — ماشي هنا تلقائياً، لأن
-- تشفير كل الصفوف الموجودة عملية حساسة تحتاج تشغيل مراقَب، ماشي
-- جزء من migration تلقائية وقت النشر.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_lookup_hash VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_enc BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_iv BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_tag BYTEA;

-- أي قسم شفّر بريد هذا المستخدم — يُحدَّد وقت التسجيل حسب العميل
-- (X-Client-Key) اللي سجّل بيه: web/android/ios. المستخدمون
-- الحاليون (قبل هذا الإصدار) يُفترضون 'web' افتراضياً بالسكريبت.
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_section VARCHAR(10) DEFAULT 'web'
  CHECK (data_section IN ('web', 'android', 'ios'));

-- ⚠️ ماشي UNIQUE — نفس البريد ممكن يتكرر لحد 3 حسابات (ميزة
-- linkedAccounts.service.js الموجودة أصلاً)، فالبحث لازم يرجّع
-- كل الصفوف المطابقة، ماشي صف واحد فقط
CREATE INDEX IF NOT EXISTS idx_users_email_lookup_hash ON users(email_lookup_hash);

-- عمود email الأصلي (نص عادي) يبقى مؤقتاً بعد هذه Migration —
-- يُصفَّر (SET NULL) فقط بعد تشغيل سكريبت التحويل بنجاح والتأكد
-- أن كل صف عندو email_enc. لا تُصفِّره يدوياً قبل ذلك، أو تفقد
-- القدرة على التحقق من نجاح التحويل.
