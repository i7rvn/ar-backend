-- ═══════════════════════════════════════════════════════════════
-- Migration 010 : تشفير 3 الأقسام المعزولة (Web / Android / iOS)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE encryption_sections (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 section VARCHAR(20) UNIQUE NOT NULL CHECK (section IN ('web','android','ios')),
 public_key TEXT NOT NULL,
 key_version INTEGER DEFAULT 1,
 rotated_at TIMESTAMPTZ DEFAULT NOW()
);

-- مفاتيح X25519 لكل جهاز مستخدم (للرسائل E2E الحقيقية)
CREATE TABLE user_device_keys (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 device_id UUID REFERENCES sessions_devices(id) ON DELETE CASCADE,
 public_key TEXT NOT NULL,
 fingerprint VARCHAR(128) NOT NULL, -- safety number لعرضه على المستخدم
 verified BOOLEAN DEFAULT FALSE, -- تحقّق الطرف الآخر يدوياً
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_user_device_keys_user ON user_device_keys(user_id);
