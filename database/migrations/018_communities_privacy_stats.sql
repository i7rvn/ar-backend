-- Migration 018 : تفضيلات الإشعارات + الخصوصية + السمعة + إيصالات
--                  التسليم بالرسائل + المجتمعات + تتبّع إحصائيات صانع المحتوى

-- ─── تفضيلات الإشعارات (toggle حقيقي لكل نوع) ──────────────────
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  likes BOOLEAN DEFAULT TRUE,
  follows BOOLEAN DEFAULT TRUE,
  replies BOOLEAN DEFAULT TRUE,
  reposts BOOLEAN DEFAULT TRUE,
  messages BOOLEAN DEFAULT TRUE,
  community_posts BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── الخصوصية ────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS who_can_message VARCHAR(20)
  DEFAULT 'everyone' CHECK (who_can_message IN ('everyone', 'followers'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE;

-- ─── نظام السمعة (نقاط + مستوى محسوب) ──────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_points INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION reputation_level(points INTEGER)
RETURNS VARCHAR(20) AS $$
BEGIN
  IF points >= 10000 THEN RETURN 'legendary';
  ELSIF points >= 2500 THEN RETURN 'expert';
  ELSIF points >= 500 THEN RETURN 'active';
  ELSIF points >= 100 THEN RETURN 'rising';
  ELSE RETURN 'newcomer';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─── إيصالات تسليم الرسائل (منفصلة عن إيصالات القراءة الموجودة) ──
CREATE TABLE message_deliveries (
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

-- ─── المجتمعات ────────────────────────────────────────────────────
CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  avatar_url VARCHAR(500),
  banner_url VARCHAR(500),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  members_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_communities_slug ON communities(slug);

CREATE TABLE community_members (
  community_id UUID REFERENCES communities(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'owner')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX idx_community_members_user ON community_members(user_id);

-- المنشورات بمجتمع معيّن (نفس جدول posts، مع ربط اختياري بمجتمع)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES communities(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_posts_community ON posts(community_id);

-- ─── تتبّع إحصائيات صانع المحتوى ─────────────────────────────────
CREATE TABLE post_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_post_views_post ON post_views(post_id, created_at DESC);

CREATE TABLE profile_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  viewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_profile_views_profile ON profile_views(profile_user_id, created_at DESC);
