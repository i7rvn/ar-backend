-- Migration 017 : تصحيح بنيوي حرج
--
-- كان عمود users.email يحمل قيد UNIQUE، وهذا يمنع فعلياً إنشاء أي
-- حساب ثانٍ بنفس البريد - يناقض مباشرة ميزة "حد أقصى 3 حسابات لكل
-- بريد" (مبنية بجدول linked_accounts وخدمة linkedAccounts.service.js)
-- التي افترضت إمكانية وجود عدة صفوف بنفس البريد. الحد الأقصى يبقى
-- مضبوطاً على مستوى التطبيق (system_settings: max_accounts_per_email)
-- لا حاجة لقيد قاعدة بيانات صارم هنا بعد هذا التصحيح.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;

-- فهرس عادي (لا UNIQUE) يبقى مفيداً لسرعة البحث بالبريد
CREATE INDEX IF NOT EXISTS idx_users_email_lookup ON users(email);
