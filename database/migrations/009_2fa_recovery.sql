-- ═══════════════════════════════════════════════════════════════
-- Migration 009 : التحقق بخطوتين (TOTP) + أكواد الاسترجاع
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE totp_secrets (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 secret_enc TEXT NOT NULL, -- مشفّر بمفتاح التطبيق
 is_enabled BOOLEAN DEFAULT FALSE,
 enabled_at TIMESTAMPTZ,
 last_prompted_at TIMESTAMPTZ, -- آخر مرة ظهرت النافذة الترحيبية
 created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recovery_codes (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 code_hash VARCHAR(255) NOT NULL, -- كل كود مخزّن مُجزَّأ (hash)
 used BOOLEAN DEFAULT FALSE,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id);
