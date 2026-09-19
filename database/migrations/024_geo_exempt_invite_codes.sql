-- ═══════════════════════════════════════════════════════════════
-- Migration 024 : علم الإعفاء الجغرافي الدائم + أكواد دعوة المغتربين
-- ═══════════════════════════════════════════════════════════════
--
-- geo_exempt: علم دائم على الحساب (ماشي "مرة وحدة عند التسجيل" فقط) —
-- بمجرد ما يتفعّل، vpnGuard يتجاوز فحص VPN/Proxy/Geo لهذا المستخدم
-- بكل طلب لاحق (دخول وتصفح)، ماشي بس أول تسجيل.

ALTER TABLE users ADD COLUMN IF NOT EXISTS geo_exempt BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(64) UNIQUE NOT NULL,
  created_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note VARCHAR(200), -- سبب الدعوة (اختياري، للأدمن فقط)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_unused ON invite_codes(expires_at) WHERE used_at IS NULL;
