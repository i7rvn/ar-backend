-- ═══════════════════════════════════════════════════════════════
-- Migration 020 : صلاحيات وأدوار جديدة لدعم Admin Dashboard الكامل
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- نوع المجتمع (عام/مغلق) — مطلوب لصفحة إدارة المجتمعات بالداشبورد،
-- ماكانش موجود بالمخطط الأصلي
ALTER TABLE communities ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE;

-- تمييز جلسات الـ impersonation (لو استُعملت لاحقاً بجدول sessions
-- بدل الاكتفاء بعدم إنشاء صف أصلاً — احتياط فقط)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_impersonation BOOLEAN DEFAULT FALSE;

-- تصنيف الإعدادات لعرضها مجمّعة بصفحة "الإعدادات" بالداشبورد
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'general';
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS label VARCHAR(150);

-- إعدادات تنبيهات بوت Telegram — قابلة للتبديل من الداشبورد بدل
-- كونها ثابتة بالكود، كيما اتفقنا
INSERT INTO system_settings (key, value, category, label, description) VALUES
  ('telegram_alert_db_errors', 'true', 'telegram', 'أخطاء قاعدة البيانات', 'إرسال تنبيه Telegram عند أخطاء DB حرجة'),
  ('telegram_alert_intrusion_attempts', 'true', 'telegram', 'محاولات اختراق', 'إرسال تنبيه Telegram عند رصد محاولة اختراق'),
  ('telegram_alert_general', 'false', 'telegram', 'تنبيهات عامة', 'إرسال تنبيهات عامة أخرى (دخول أدمن جديد...)'),
  ('encryption_session_ttl_seconds', '600', 'security', 'مدة جلسة فتح قسم التشفير (ثانية)', 'كم تبقى جلسة فتح قسم التشفير صالحة قبل القفل التلقائي')
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (key, module, description) VALUES
 ('users.impersonate', 'users', 'دخول لحساب مستخدم بلا كلمة سره'),
 ('communities.view', 'communities', 'عرض المجتمعات'),
 ('communities.delete', 'communities', 'حذف مجتمع'),
 ('reports.view', 'reports', 'عرض ومعالجة البلاغات'),
 ('security_events.view', 'security', 'عرض الأحداث الأمنية ومحاولات VPN'),
 ('trusted_ips.manage', 'security', 'إدارة قائمة IP الموثوقة والمحظورة'),
 ('content.moderate', 'security', 'مراجعة المحتوى، نقاط السبام، الكلمات المحظورة'),
 ('stats.view', 'stats', 'عرض إحصائيات لوحة القيادة'),
 ('master_key.unlock', 'security', 'فتح/قفل Master Key (يفتح كل التشفير بالمنصة)')
ON CONFLICT (key) DO NOTHING;

-- دور جديد: Platform Admin (وصول مقيّد حسب منصة Web/Android/iOS)
INSERT INTO roles (name, is_system) VALUES ('platform_admin', FALSE)
ON CONFLICT (name) DO NOTHING;

-- ─── صلاحيات افتراضية معقولة للأدوار الموجودة — قابلة للتعديل من
-- صفحة "إدارة الأدمنز والصلاحيات" بالداشبورد، هاذي بداية فقط ────

-- security_admin: كل شيء متعلق بالأمان + المستخدمين (بلا حذف)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'security_admin' AND p.key IN (
  'users.view', 'users.ban', 'users.unban',
  'security_events.view', 'trusted_ips.manage', 'security.view',
  'security.block_ip', 'master_key.unlock', 'audit.view', 'stats.view'
)
ON CONFLICT DO NOTHING;

-- moderator (Content Moderator): محتوى + بلاغات + منشورات
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'moderator' AND p.key IN (
  'posts.view', 'posts.delete', 'reports.view', 'content.moderate',
  'communities.view', 'users.view', 'stats.view'
)
ON CONFLICT DO NOTHING;

-- support: عرض المستخدمين والبلاغات فقط، بلا إجراءات خطيرة
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'support' AND p.key IN (
  'users.view', 'reports.view', 'stats.view'
)
ON CONFLICT DO NOTHING;

-- platform_admin: إدارة الأدمنز محصورة بمنصته (الفحص الفعلي للمنصة
-- يتم بكود الـ route نفسه عبر admin_platform_access، هذا الجدول
-- يعطيه فقط صلاحية الوصول لقسم الأدمنز)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'platform_admin' AND p.key IN (
  'users.view', 'stats.view'
)
ON CONFLICT DO NOTHING;
