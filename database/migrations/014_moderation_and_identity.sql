-- Migration 014 : الحظر بين المستخدمين + الكتم + التقييد + ترتيب البلاغات
--                  + معرّف داخلي ثابت + سجل أسماء المستخدمين

-- ─── الحظر بين المستخدمين (منفصل عن حظر الأدمن الإداري) ────────
CREATE TABLE user_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);
CREATE INDEX idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON user_blocks(blocked_id);

-- ─── الكتم (منفصل عن الحظر: المكتوم لا يعرف أنه مكتوم) ─────────
CREATE TABLE user_mutes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  muter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (muter_id, muted_id),
  CHECK (muter_id != muted_id)
);
CREATE INDEX idx_user_mutes_muter ON user_mutes(muter_id);

-- ─── التقييد (رؤية محدودة للمنشورات، دون حظر أو كتم صريح) ──────
CREATE TABLE user_restricts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restricter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restricted_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (restricter_id, restricted_id),
  CHECK (restricter_id != restricted_id)
);
CREATE INDEX idx_user_restricts_restricter ON user_restricts(restricter_id);

-- ─── ترتيب البلاغات حسب الخطورة ─────────────────────────────────
-- severity_weight يُحسَب عند إنشاء البلاغ حسب نوع المخالفة (reason)،
-- والترتيب النهائي بالداشبورد يكون: severity_weight × عدد البلاغات
-- على نفس الهدف، وليس ترتيباً زمنياً فقط.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS severity_weight INTEGER DEFAULT 1;

CREATE OR REPLACE VIEW reports_ranked AS
SELECT
  r.*,
  COUNT(*) OVER (PARTITION BY COALESCE(r.reported_user_id, r.reported_post_id)) AS related_reports_count,
  r.severity_weight * COUNT(*) OVER (PARTITION BY COALESCE(r.reported_user_id, r.reported_post_id)) AS priority_score
FROM reports r
WHERE r.status = 'pending';

-- ─── معرّف داخلي ثابت لكل مستخدم (لا يظهر بالواجهة) ─────────────
CREATE SEQUENCE IF NOT EXISTS user_internal_id_seq START 1;

ALTER TABLE users ADD COLUMN IF NOT EXISTS internal_id VARCHAR(20) UNIQUE;

UPDATE users SET internal_id = 'AR-' || LPAD(nextval('user_internal_id_seq')::TEXT, 8, '0')
WHERE internal_id IS NULL;

ALTER TABLE users ALTER COLUMN internal_id SET DEFAULT
  ('AR-' || LPAD(nextval('user_internal_id_seq')::TEXT, 8, '0'));
ALTER TABLE users ALTER COLUMN internal_id SET NOT NULL;

-- ─── سجل أسماء المستخدمين القديمة (حجز مؤقت بعد التغيير) ────────
CREATE TABLE username_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  old_username VARCHAR(50) NOT NULL,
  released_at TIMESTAMPTZ NOT NULL, -- بعدها يصبح الاسم متاحاً لغيره
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_username_history_name ON username_history(old_username);

-- ─── توسيع قائمة الأسماء المحجوزة ────────────────────────────────
INSERT INTO reserved_usernames (username, reason) VALUES
  ('administrator', 'system'), ('security', 'system'), ('staff', 'system'),
  ('official', 'system'), ('ar', 'system'), ('moderator', 'system'),
  ('help', 'system'), ('info', 'system'), ('contact', 'system'),
  ('billing', 'system'), ('null', 'system'), ('undefined', 'system')
ON CONFLICT DO NOTHING;
