-- Migration 019 : إزالة إنشاء الإشعارات من داخل Triggers قاعدة البيانات
--
-- كانت triggers قاعدة البيانات (update_likes_count, update_reposts_count,
-- update_replies_count, update_follows_count) تُدرج إشعاراً مباشرة عند كل
-- إعجاب/ريتويت/رد/متابعة، بالتوازي مع الإشعار الذي يُنشئه الآن التطبيق
-- عبر modules/notifications/notifications.service.js (الذي يحترم تفضيلات
-- المستخدم قبل الإنشاء). النتيجة كانت إشعاراً مكرَّراً مرتين لكل حدث.
-- هذا الترحيل يعيد تعريف الدوال بحيث تحدّث العدادات فقط، بلا إنشاء إشعار،
-- ويترك الإشعار للتطبيق حصرياً.

CREATE OR REPLACE FUNCTION update_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_reposts_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET reposts_count = reposts_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET reposts_count = GREATEST(reposts_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_replies_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.reply_to_id IS NOT NULL THEN
    UPDATE posts SET replies_count = replies_count + 1 WHERE id = NEW.reply_to_id;
  ELSIF TG_OP = 'DELETE' AND OLD.reply_to_id IS NOT NULL THEN
    UPDATE posts SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = OLD.reply_to_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_follows_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
