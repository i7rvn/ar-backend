-- ═══════════════════════════════════════════════════════════════
-- AR App — Migration 004 : الأمان والتشفير المتقدم
-- ═══════════════════════════════════════════════════════════════

-- ─── مفاتيح التشفير (مشفرة بـ Master Password) ───────────────
CREATE TABLE encryption_keys (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 -- المفتاح الخاص مشفر بـ Master Key (الأدمن فقط يفكه)
 encrypted_private_key TEXT NOT NULL,
 -- المفتاح العام مرئي للجميع (للتشفير E2E)
 public_key TEXT NOT NULL,
 -- مفتاح تشفير البيانات الشخصية (مشفر بـ Master Key)
 encrypted_data_key TEXT NOT NULL,
 key_version INTEGER DEFAULT 1,
 last_rotated_at TIMESTAMPTZ DEFAULT NOW(),
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── فحوصات المحتوى ───────────────────────────────────────────
CREATE TABLE content_checks (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 content_type VARCHAR(20) NOT NULL, -- post / image / comment
 content_id UUID,
 user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 -- نتائج Google Perspective
 toxicity_score FLOAT DEFAULT 0,
 hate_score FLOAT DEFAULT 0,
 threat_score FLOAT DEFAULT 0,
 spam_score_ai FLOAT DEFAULT 0,
 -- نتائج Hugging Face (للصور)
 nsfw_score FLOAT DEFAULT 0,
 violence_score FLOAT DEFAULT 0,
 -- القرار
 action VARCHAR(20) DEFAULT 'approved', -- approved/rejected/review
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 raw_response JSONB,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── نقاط السبام لكل مستخدم ───────────────────────────────────
CREATE TABLE spam_scores (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 score INTEGER DEFAULT 0,
 posts_today INTEGER DEFAULT 0,
 duplicate_count INTEGER DEFAULT 0,
 report_count INTEGER DEFAULT 0,
 last_action_at TIMESTAMPTZ DEFAULT NOW(),
 auto_banned BOOLEAN DEFAULT FALSE,
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── أحداث الأمان المتقدمة ─────────────────────────────────────
CREATE TABLE security_events (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 ip_address INET,
 event_type VARCHAR(100) NOT NULL,
 -- login_brute_force / sql_injection / xss_attempt
 -- content_rejected / spam_detected / key_rotation
 severity VARCHAR(20) DEFAULT 'info',
 details JSONB,
 resolved BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── الكلمات المحظورة ─────────────────────────────────────────
CREATE TABLE blocked_words (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 word VARCHAR(200) UNIQUE NOT NULL,
 severity VARCHAR(20) DEFAULT 'warn', -- warn / reject / ban
 added_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── IPs الموثوقة (whitelist) ─────────────────────────────────
CREATE TABLE trusted_ips (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 ip_address INET UNIQUE NOT NULL,
 label VARCHAR(100),
 added_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── سجل تدوير المفاتيح ───────────────────────────────────────
CREATE TABLE key_rotations (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 old_version INTEGER,
 new_version INTEGER,
 rotated_by VARCHAR(50) DEFAULT 'auto', -- auto / admin
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_content_checks_action ON content_checks(action, created_at DESC);
CREATE INDEX idx_content_checks_user ON content_checks(user_id);
CREATE INDEX idx_spam_scores_score ON spam_scores(score DESC);
CREATE INDEX idx_security_events_type ON security_events(event_type, created_at DESC);
CREATE INDEX idx_security_events_user ON security_events(user_id, created_at DESC);
CREATE INDEX idx_key_rotations_user ON key_rotations(user_id);

-- ─── Trigger: تحديث نقاط السبام ──────────────────────────────
CREATE OR REPLACE FUNCTION reset_daily_spam_scores()
RETURNS void AS $$
BEGIN
 UPDATE spam_scores
 SET posts_today = 0, updated_at = NOW()
 WHERE DATE(updated_at) < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- ─── بيانات افتراضية: كلمات محظورة ───────────────────────────
INSERT INTO blocked_words (word, severity) VALUES
 ('spam', 'warn'),
 ('إعلان', 'warn'),
 ('ربح سريع','reject'),
 ('اشترِ الآن','warn')
ON CONFLICT DO NOTHING;
