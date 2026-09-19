// ═══════════════════════════════════════════════════════════════
// AR App — إنشاء الإشعارات (نقطة مركزية واحدة تحترم تفضيلات المستقبل)
// ═══════════════════════════════════════════════════════════════

const { query } = require('../../config/database');

const PREFERENCE_COLUMN = {
  like: 'likes',
  follow: 'follows',
  reply: 'replies',
  repost: 'reposts',
  community_post: 'community_posts',
};

async function isNotificationAllowed(userId, type) {
  const column = PREFERENCE_COLUMN[type];
  if (!column) return true; // أنواع بلا تفضيل مخصَّص (مثل mention) مفعّلة دائماً

  const result = await query(
    `SELECT ${column} FROM notification_preferences WHERE user_id = $1`,
    [userId]
  );
  // لا صف يعني المستخدم لم يعدّل تفضيلاته بعد - القيمة الافتراضية مفعّلة
  return result.rows.length === 0 ? true : result.rows[0][column];
}

// ─── إنشاء إشعار — لا يُنشأ إشعار للفاعل نفسه، ويحترم تفضيله ────
async function createNotification({ userId, actorId, type, postId = null }) {
  if (userId === actorId) return;

  const allowed = await isNotificationAllowed(userId, type);
  if (!allowed) return;

  await query(
    `INSERT INTO notifications (user_id, actor_id, type, post_id) VALUES ($1, $2, $3, $4)`,
    [userId, actorId, type, postId]
  );
}

module.exports = { createNotification };
