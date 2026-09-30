-- ═══════════════════════════════════════════════════════════════
-- Migration 006 : نظام RBAC الديناميكي (Permissions بدل الأدوار الثابتة)
-- ═══════════════════════════════════════════════════════════════

-- كل صلاحية ممكنة بالنظام (users.ban, posts.delete, admins.create...)
CREATE TABLE permissions (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 key VARCHAR(100) UNIQUE NOT NULL, -- مثال: 'users.ban'
 module VARCHAR(50) NOT NULL, -- مثال: 'users'
 description TEXT,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- الأدوار (Owner, Security Admin, Moderator, Support...)
CREATE TABLE roles (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 name VARCHAR(50) UNIQUE NOT NULL,
 is_system BOOLEAN DEFAULT FALSE, -- true = Owner، لا يُحذف
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ربط دور بصلاحيات (many-to-many) + wildcard
CREATE TABLE role_permissions (
 role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
 permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
 PRIMARY KEY (role_id, permission_id)
);

-- جدول الأدمنز (منفصل عن users العاديين)
CREATE TABLE admins (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 role_id UUID REFERENCES roles(id),
 is_owner BOOLEAN DEFAULT FALSE,
 totp_required BOOLEAN DEFAULT TRUE, -- 2FA إجباري للأدمنز
 created_by UUID REFERENCES admins(id),
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- صلاحيات الوصول للأنصة (Web/Android/iOS) خاصة بالـ Platform Admin
CREATE TABLE admin_platform_access (
 admin_id UUID REFERENCES admins(id) ON DELETE CASCADE,
 platform VARCHAR(20) NOT NULL CHECK (platform IN ('web','android','ios','dashboard')),
 PRIMARY KEY (admin_id, platform)
);

-- منع حذف/تعديل الـ Owner عبر قيد قاعدة بيانات (حماية إضافية عن الكود)
CREATE UNIQUE INDEX idx_single_owner ON admins (is_owner) WHERE is_owner = TRUE;

-- الصلاحيات الافتراضية
INSERT INTO permissions (key, module, description) VALUES
 ('users.view', 'users', 'عرض المستخدمين'),
 ('users.ban', 'users', 'حظر مستخدم'),
 ('users.unban', 'users', 'رفع الحظر'),
 ('users.verify', 'users', 'توثيق حساب'),
 ('users.delete', 'users', 'حذف مستخدم'),
 ('posts.view', 'posts', 'عرض المنشورات'),
 ('posts.delete', 'posts', 'حذف منشور'),
 ('admins.create', 'admins', 'إنشاء أدمن'),
 ('admins.edit', 'admins', 'تعديل أدمن'),
 ('admins.delete', 'admins', 'حذف أدمن'),
 ('permissions.manage','admins', 'تعديل صلاحيات الأدوار'),
 ('audit.view', 'audit', 'عرض سجل التدقيق'),
 ('security.view', 'security','عرض سجلات الأمان'),
 ('security.block_ip', 'security','حظر IP يدوياً'),
 ('settings.manage', 'settings','تعديل إعدادات النظام'),
 ('*', 'system', 'كل الصلاحيات (Owner فقط)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO roles (name, is_system) VALUES
 ('owner', TRUE),
 ('security_admin', FALSE),
 ('moderator', FALSE),
 ('support', FALSE)
ON CONFLICT (name) DO NOTHING;

-- الـ Owner يحصل على '*' (wildcard) تلقائياً
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'owner' AND p.key = '*'
ON CONFLICT DO NOTHING;
