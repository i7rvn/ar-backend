-- ═══════════════════════════════════════════════════════════════
-- Migration 008 : الأجهزة والجلسات المتقدمة
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE sessions_devices (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 fingerprint VARCHAR(128) NOT NULL, -- hash(UA + IP + lang)
 device_name VARCHAR(150), -- "Chrome على Windows"
 device_type VARCHAR(30), -- mobile/desktop/tablet
 ip_address INET,
 last_seen_at TIMESTAMPTZ DEFAULT NOW(),
 is_current BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sessions_devices_user ON sessions_devices(user_id, last_seen_at DESC);
CREATE INDEX idx_sessions_devices_fp ON sessions_devices(user_id, fingerprint);

-- تنبيهات جهاز جديد (لمنع تكرار الإرسال لنفس الجهاز)
CREATE TABLE new_device_alerts (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 fingerprint VARCHAR(128) NOT NULL,
 alerted_at TIMESTAMPTZ DEFAULT NOW()
);
