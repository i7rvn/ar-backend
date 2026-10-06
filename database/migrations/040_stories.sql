-- Migration 040 : Stories (24 ساعة)
CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  caption VARCHAR(280),
  visibility VARCHAR(20) NOT NULL DEFAULT 'followers'
    CHECK (visibility IN ('public', 'followers')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE story_views (
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX idx_stories_active ON stories(expires_at, created_at DESC);
CREATE INDEX idx_stories_user ON stories(user_id, expires_at DESC);
CREATE INDEX idx_story_views_story ON story_views(story_id);
