-- ═══════════════════════════════════════════════════════════════
-- AR App — Migration 001 : الجداول الأساسية
-- ═══════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── المستخدمون ───────────────────────────────────────────────
CREATE TABLE users (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 email VARCHAR(255) UNIQUE NOT NULL,
 username VARCHAR(50) UNIQUE NOT NULL,
 password_hash VARCHAR(255) NOT NULL,
 display_name VARCHAR(100) NOT NULL,
 bio TEXT,
 avatar_url VARCHAR(500),
 banner_url VARCHAR(500),
 location VARCHAR(100),
 website VARCHAR(200),
 public_key TEXT, -- مفتاح التشفير العام
 is_verified BOOLEAN DEFAULT FALSE, -- علامة التوثيق
 is_admin BOOLEAN DEFAULT FALSE,
 is_banned BOOLEAN DEFAULT FALSE,
 ban_reason TEXT,
 posts_count INTEGER DEFAULT 0,
 followers_count INTEGER DEFAULT 0,
 following_count INTEGER DEFAULT 0,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── رموز OTP ─────────────────────────────────────────────────
CREATE TABLE otp_codes (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 email VARCHAR(255) NOT NULL,
 code VARCHAR(6) NOT NULL,
 attempts INTEGER DEFAULT 0,
 expires_at TIMESTAMPTZ NOT NULL,
 used BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── جلسات تسجيل الدخول ───────────────────────────────────────
CREATE TABLE sessions (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 token_hash VARCHAR(255) NOT NULL,
 ip_address INET,
 user_agent TEXT,
 device_info JSONB,
 is_active BOOLEAN DEFAULT TRUE,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── سجل VPN والـ IPs المحجوبة ────────────────────────────────
CREATE TABLE vpn_logs (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 ip_address INET NOT NULL,
 reason VARCHAR(100), -- vpn / proxy / tor / not_algeria
 details JSONB,
 blocked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE blocked_ips (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 ip_address INET UNIQUE NOT NULL,
 reason VARCHAR(200),
 blocked_until TIMESTAMPTZ, -- NULL = محجوب دائماً
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── سجلات الأمان ─────────────────────────────────────────────
CREATE TABLE security_logs (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 ip_address INET,
 event_type VARCHAR(100) NOT NULL, -- login / register / otp_fail / ban ...
 details JSONB,
 severity VARCHAR(20) DEFAULT 'info', -- info / warning / critical
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes للسرعة ───────────────────────────────────────────
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_otp_email ON otp_codes(email, expires_at);
CREATE INDEX idx_sessions_user ON sessions(user_id, is_active);
CREATE INDEX idx_vpn_ip ON vpn_logs(ip_address);
CREATE INDEX idx_blocked_ip ON blocked_ips(ip_address);
CREATE INDEX idx_security_user ON security_logs(user_id, created_at);
CREATE INDEX idx_security_event ON security_logs(event_type, created_at);

-- ─── Trigger: تحديث updated_at تلقائياً ──────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
 NEW.updated_at = NOW();
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
 BEFORE UPDATE ON users
 FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── دالة تنظيف OTP المنتهية ──────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
 DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
