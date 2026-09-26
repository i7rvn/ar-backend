-- ═══════════════════════════════════════════════════════════════
-- Migration 007 : Auth متقدم — 3 حسابات/بريد + Password History + يوزرنيمات محجوزة
-- ═══════════════════════════════════════════════════════════════

-- تاريخ كلمات المرور (منع إعادة استخدام آخر 5)
CREATE TABLE password_history (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 password_hash VARCHAR(255) NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_password_history_user ON password_history(user_id, created_at DESC);

-- أسماء مستخدمين محجوزة (admin, support, ar_official...)
CREATE TABLE reserved_usernames (
 username VARCHAR(50) PRIMARY KEY,
 reason TEXT
);

-- ربط الحسابات المتعددة بنفس البريد (حد أقصى 3)
CREATE TABLE linked_accounts (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 email VARCHAR(255) NOT NULL,
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE(email, user_id)
);
CREATE INDEX idx_linked_accounts_email ON linked_accounts(email);

-- عمود آخر تغيير يوزرنيم (لفرض حد 30 يوم)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

-- طلبات حذف الحساب المتدرج (30 يوم)
CREATE TABLE account_deletion_requests (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 requested_at TIMESTAMPTZ DEFAULT NOW(),
 scheduled_for TIMESTAMPTZ NOT NULL, -- requested_at + 30 يوم
 cancelled BOOLEAN DEFAULT FALSE,
 cancelled_at TIMESTAMPTZ
);

-- سجل نشاط كل تغيير بالحساب (بريد، كلمة مرور، يوزرنيم...)
CREATE TABLE activity_history (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 action VARCHAR(100) NOT NULL, -- 'email_changed', 'password_changed'...
 ip_address INET,
 details JSONB,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activity_history_user ON activity_history(user_id, created_at DESC);

INSERT INTO reserved_usernames (username, reason) VALUES
 ('admin', 'system'), ('support', 'system'), ('ar_official', 'system'),
 ('root', 'system'), ('api', 'system'), ('owner', 'system')
ON CONFLICT DO NOTHING;
