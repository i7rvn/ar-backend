-- Migration 032 : Polls للمنشورات
CREATE TABLE polls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID UNIQUE NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE TABLE poll_options (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_text VARCHAR(100) NOT NULL CHECK (char_length(trim(option_text)) BETWEEN 1 AND 100),
  position SMALLINT NOT NULL CHECK (position >= 0),
  UNIQUE (poll_id, position),
  UNIQUE (id, poll_id)
);

CREATE TABLE poll_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (poll_id, user_id),
  FOREIGN KEY (option_id, poll_id) REFERENCES poll_options(id, poll_id) ON DELETE CASCADE
);

CREATE INDEX idx_polls_post ON polls(post_id);
CREATE INDEX idx_poll_options_poll ON poll_options(poll_id, position);
CREATE INDEX idx_poll_votes_poll ON poll_votes(poll_id);
CREATE INDEX idx_poll_votes_option ON poll_votes(option_id);
