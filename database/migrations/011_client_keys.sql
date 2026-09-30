-- ═══════════════════════════════════════════════════════════════
-- Migration 011 : مفاتيح العملاء (Web/Dashboard/Android/iOS) — الحجاب الأمني الأول
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE client_keys (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 client_name VARCHAR(50) UNIQUE NOT NULL, -- 'web','dashboard','android','ios'
 api_key VARCHAR(128) UNIQUE NOT NULL,
 is_active BOOLEAN DEFAULT TRUE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 revoked_at TIMESTAMPTZ
);
