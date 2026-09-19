-- ═══════════════════════════════════════════════════════════════
-- AR App — Migration 003 : الرسائل والمحادثات
-- ═══════════════════════════════════════════════════════════════

-- ─── المحادثات ────────────────────────────────────────────────
CREATE TABLE conversations (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 type VARCHAR(20) DEFAULT 'direct', -- direct / group
 name VARCHAR(100), -- اسم المجموعة
 avatar_url VARCHAR(500),
 created_by UUID REFERENCES users(id) ON DELETE SET NULL,
 last_msg_at TIMESTAMPTZ,
 last_msg_text TEXT,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── أعضاء المحادثة ───────────────────────────────────────────
CREATE TABLE conversation_members (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role VARCHAR(20) DEFAULT 'member', -- admin / member
 unread_count INTEGER DEFAULT 0,
 is_muted BOOLEAN DEFAULT FALSE,
 joined_at TIMESTAMPTZ DEFAULT NOW(),
 last_read_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE (conversation_id, user_id)
);

-- ─── الرسائل المشفرة ──────────────────────────────────────────
CREATE TABLE messages (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 -- التشفير E2E: المحتوى مشفر، السرفر لا يقرأه
 encrypted_content TEXT NOT NULL,
 nonce VARCHAR(64) NOT NULL, -- للفك
 msg_type VARCHAR(20) DEFAULT 'text', -- text/image/video/audio/file
 media_url VARCHAR(500),
 reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
 is_deleted BOOLEAN DEFAULT FALSE,
 is_edited BOOLEAN DEFAULT FALSE,
 expires_at TIMESTAMPTZ, -- للرسائل التي تختفي
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── حالة قراءة الرسائل ───────────────────────────────────────
CREATE TABLE message_reads (
 message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 read_at TIMESTAMPTZ DEFAULT NOW(),
 PRIMARY KEY (message_id, user_id)
);

-- ─── حالة المستخدم (أونلاين/أوفلاين) ─────────────────────────
CREATE TABLE user_status (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 is_online BOOLEAN DEFAULT FALSE,
 last_seen TIMESTAMPTZ DEFAULT NOW(),
 socket_id VARCHAR(100)
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_conv_members_user ON conversation_members(user_id);
CREATE INDEX idx_conv_members_conv ON conversation_members(conversation_id);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_message_reads_msg ON message_reads(message_id);
CREATE INDEX idx_user_status_online ON user_status(is_online);

-- ─── Trigger: تحديث آخر رسالة في المحادثة ────────────────────
CREATE OR REPLACE FUNCTION update_conversation_last_msg()
RETURNS TRIGGER AS $$
BEGIN
 UPDATE conversations
 SET last_msg_at = NEW.created_at,
 last_msg_text = LEFT(NEW.encrypted_content, 50),
 updated_at = NOW()
 WHERE id = NEW.conversation_id;

 -- زيادة عداد غير المقروء لكل أعضاء المحادثة عدا المرسل
 UPDATE conversation_members
 SET unread_count = unread_count + 1
 WHERE conversation_id = NEW.conversation_id
 AND user_id != NEW.sender_id;

 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_conv_last_msg
 AFTER INSERT ON messages
 FOR EACH ROW EXECUTE FUNCTION update_conversation_last_msg();

-- ─── دالة تنظيف الرسائل المنتهية (تلقائي) ────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_messages()
RETURNS void AS $$
BEGIN
 UPDATE messages
 SET is_deleted = TRUE, encrypted_content = '[رسالة محذوفة]'
 WHERE expires_at < NOW() AND is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql;
