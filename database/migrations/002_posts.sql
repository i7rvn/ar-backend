-- ═══════════════════════════════════════════════════════════════
-- AR App — Migration 002 : المنشورات والتفاعل
-- ═══════════════════════════════════════════════════════════════

-- ─── المنشورات ────────────────────────────────────────────────
CREATE TABLE posts (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 content TEXT NOT NULL CHECK (char_length(content) <= 280),
 media_urls TEXT[] DEFAULT '{}', -- روابط الصور/الفيديو
 media_types TEXT[] DEFAULT '{}', -- image / video / gif
 reply_to_id UUID REFERENCES posts(id) ON DELETE SET NULL,
 repost_of_id UUID REFERENCES posts(id) ON DELETE SET NULL,
 quote_of_id UUID REFERENCES posts(id) ON DELETE SET NULL,
 likes_count INTEGER DEFAULT 0,
 reposts_count INTEGER DEFAULT 0,
 replies_count INTEGER DEFAULT 0,
 quotes_count INTEGER DEFAULT 0,
 views_count INTEGER DEFAULT 0,
 is_deleted BOOLEAN DEFAULT FALSE,
 is_pinned BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── الإعجابات ────────────────────────────────────────────────
CREATE TABLE likes (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE (user_id, post_id)
);

-- ─── الريتويت ─────────────────────────────────────────────────
CREATE TABLE reposts (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE (user_id, post_id)
);

-- ─── المتابعة ─────────────────────────────────────────────────
CREATE TABLE follows (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE (follower_id, following_id),
 CHECK (follower_id != following_id)
);

-- ─── الهاشتاقات ───────────────────────────────────────────────
CREATE TABLE hashtags (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 tag VARCHAR(100) UNIQUE NOT NULL,
 posts_count INTEGER DEFAULT 0,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE post_hashtags (
 post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
 hashtag_id UUID REFERENCES hashtags(id) ON DELETE CASCADE,
 PRIMARY KEY (post_id, hashtag_id)
);

-- ─── الإشعارات ────────────────────────────────────────────────
CREATE TABLE notifications (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- المستقبل
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- الفاعل
 type VARCHAR(50) NOT NULL, -- like/repost/follow/reply/quote/mention
 post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
 is_read BOOLEAN DEFAULT FALSE,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── البلاغات ─────────────────────────────────────────────────
CREATE TABLE reports (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 reported_post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
 reason VARCHAR(100) NOT NULL,
 details TEXT,
 status VARCHAR(20) DEFAULT 'pending', -- pending/accepted/rejected
 resolved_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ DEFAULT NOW(),
 resolved_at TIMESTAMPTZ
);

-- ─── الوسائط ──────────────────────────────────────────────────
CREATE TABLE media (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
 url VARCHAR(500) NOT NULL,
 type VARCHAR(20) NOT NULL, -- image/video/gif
 size_bytes INTEGER,
 width INTEGER,
 height INTEGER,
 duration INTEGER, -- للفيديو (ثواني)
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes للأداء ───────────────────────────────────────────
CREATE INDEX idx_posts_user_id ON posts(user_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts(created_at DESC) WHERE is_deleted = FALSE;
CREATE INDEX idx_posts_reply_to ON posts(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX idx_posts_repost_of ON posts(repost_of_id) WHERE repost_of_id IS NOT NULL;
CREATE INDEX idx_likes_post ON likes(post_id);
CREATE INDEX idx_likes_user ON likes(user_id);
CREATE INDEX idx_reposts_post ON reposts(post_id);
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_hashtags_tag ON hashtags(tag);
CREATE INDEX idx_notifs_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX idx_media_post ON media(post_id);

-- ─── Triggers تحديث العدادات ──────────────────────────────────

-- عداد الإعجابات
CREATE OR REPLACE FUNCTION update_likes_count()
RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
 UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
 -- إشعار
 INSERT INTO notifications (user_id, actor_id, type, post_id)
 SELECT p.user_id, NEW.user_id, 'like', NEW.post_id
 FROM posts p
 WHERE p.id = NEW.post_id AND p.user_id != NEW.user_id;
 ELSIF TG_OP = 'DELETE' THEN
 UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_likes_count
 AFTER INSERT OR DELETE ON likes
 FOR EACH ROW EXECUTE FUNCTION update_likes_count();

-- عداد الريتويت
CREATE OR REPLACE FUNCTION update_reposts_count()
RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
 UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = NEW.post_id;
 INSERT INTO notifications (user_id, actor_id, type, post_id)
 SELECT p.user_id, NEW.user_id, 'repost', NEW.post_id
 FROM posts p
 WHERE p.id = NEW.post_id AND p.user_id != NEW.user_id;
 ELSIF TG_OP = 'DELETE' THEN
 UPDATE posts SET reposts_count = GREATEST(reposts_count - 1, 0) WHERE id = OLD.post_id;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reposts_count
 AFTER INSERT OR DELETE ON reposts
 FOR EACH ROW EXECUTE FUNCTION update_reposts_count();

-- عداد الردود
CREATE OR REPLACE FUNCTION update_replies_count()
RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'INSERT' AND NEW.reply_to_id IS NOT NULL THEN
 UPDATE posts SET replies_count = replies_count + 1 WHERE id = NEW.reply_to_id;
 INSERT INTO notifications (user_id, actor_id, type, post_id)
 SELECT p.user_id, NEW.user_id, 'reply', NEW.id
 FROM posts p
 WHERE p.id = NEW.reply_to_id AND p.user_id != NEW.user_id;
 ELSIF TG_OP = 'DELETE' AND OLD.reply_to_id IS NOT NULL THEN
 UPDATE posts SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = OLD.reply_to_id;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_replies_count
 AFTER INSERT OR DELETE ON posts
 FOR EACH ROW EXECUTE FUNCTION update_replies_count();

-- عداد المتابعين
CREATE OR REPLACE FUNCTION update_follows_count()
RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
 UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
 UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
 INSERT INTO notifications (user_id, actor_id, type)
 VALUES (NEW.following_id, NEW.follower_id, 'follow');
 ELSIF TG_OP = 'DELETE' THEN
 UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
 UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_follows_count
 AFTER INSERT OR DELETE ON follows
 FOR EACH ROW EXECUTE FUNCTION update_follows_count();

-- عداد المنشورات
CREATE OR REPLACE FUNCTION update_posts_count()
RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
 UPDATE users SET posts_count = posts_count + 1 WHERE id = NEW.user_id;
 ELSIF TG_OP = 'DELETE' THEN
 UPDATE users SET posts_count = GREATEST(posts_count - 1, 0) WHERE id = OLD.user_id;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_posts_count
 AFTER INSERT OR DELETE ON posts
 FOR EACH ROW EXECUTE FUNCTION update_posts_count();

-- عداد الهاشتاقات
CREATE OR REPLACE FUNCTION update_hashtag_count()
RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP = 'INSERT' THEN
 UPDATE hashtags SET posts_count = posts_count + 1, updated_at = NOW()
 WHERE id = NEW.hashtag_id;
 ELSIF TG_OP = 'DELETE' THEN
 UPDATE hashtags SET posts_count = GREATEST(posts_count - 1, 0)
 WHERE id = OLD.hashtag_id;
 END IF;
 RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_hashtag_count
 AFTER INSERT OR DELETE ON post_hashtags
 FOR EACH ROW EXECUTE FUNCTION update_hashtag_count();
