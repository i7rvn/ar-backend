-- Migration 016 : سجل محاولات فتح بيانات الحسابات عبر الأقسام المعزولة

CREATE TABLE encryption_access_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID REFERENCES admins(id),
  section VARCHAR(20) NOT NULL CHECK (section IN ('web', 'android', 'ios')),
  target_user_id UUID REFERENCES users(id),
  success BOOLEAN NOT NULL,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_encryption_access_log_admin ON encryption_access_log(admin_id, created_at DESC);
