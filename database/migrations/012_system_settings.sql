-- ═══════════════════════════════════════════════════════════════
-- Migration 012 : إعدادات النظام الديناميكية + سجل التدقيق
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE system_settings (
 key VARCHAR(100) PRIMARY KEY,
 value JSONB NOT NULL,
 description TEXT,
 updated_by UUID REFERENCES admins(id),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE settings_history (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 key VARCHAR(100) NOT NULL,
 old_value JSONB,
 new_value JSONB,
 changed_by UUID REFERENCES admins(id),
 changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- سجل تدقيق موحّد لكل عمليات الأدمن (before/after)
CREATE TABLE audit_logs (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 admin_id UUID REFERENCES admins(id),
 action VARCHAR(100) NOT NULL, -- 'user.ban','settings.update'...
 target_type VARCHAR(50),
 target_id UUID,
 before_data JSONB,
 after_data JSONB,
 ip_address INET,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_admin ON audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);

-- سجل أمان بمستويات severity
ALTER TABLE security_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(10)
 DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical'));

INSERT INTO system_settings (key, value, description) VALUES
 ('max_accounts_per_email', '3', 'أقصى عدد حسابات لكل بريد'),
 ('otp_expiry_seconds', '600', 'صلاحية كود OTP بالثواني'),
 ('account_lock_attempts', '5', 'عدد المحاولات الفاشلة قبل القفل'),
 ('account_lock_minutes', '15', 'مدة القفل بالدقائق'),
 ('username_change_days', '30', 'الحد الأدنى بين تغيير اليوزرنيم'),
 ('account_deletion_days', '30', 'فترة الإلغاء بعد طلب حذف الحساب'),
 ('password_history_count','5', 'عدد كلمات المرور القديمة الممنوع تكرارها'),
 ('rate_limit_default', '100', 'الحد الافتراضي للطلبات / 15 دقيقة')
ON CONFLICT (key) DO NOTHING;
