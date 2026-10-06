const { query, withTransaction } = require('../../config/database');

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_STORIES = 50;

async function assertStoryAccess(storyId, viewerId) {
  const result = await query(
    `SELECT s.id, s.user_id, s.media_id, s.caption, s.visibility, s.expires_at,
            s.created_at, m.url, m.type, u.username, u.display_name, u.avatar_url
     FROM stories s
     JOIN media m ON m.id = s.media_id
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > NOW() AND u.is_banned = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks b
         WHERE (b.blocker_id = $2 AND b.blocked_id = s.user_id)
            OR (b.blocker_id = s.user_id AND b.blocked_id = $2)
       )
       AND (
         s.user_id = $2
         OR s.visibility = 'public'
         OR (s.visibility = 'followers' AND EXISTS (
           SELECT 1 FROM follows f
           WHERE f.follower_id = $2 AND f.following_id = s.user_id
         ))
       )`,
    [storyId, viewerId]
  );
  if (!result.rows.length) throw { status: 404, message: 'القصة غير موجودة أو لم تعد متاحة', code: 'STORY_NOT_FOUND' };
  return result.rows[0];
}

async function createStory(userId, mediaId, caption, visibility = 'followers') {
  if (typeof mediaId !== 'string') {
    throw { status: 400, message: 'mediaId مطلوب', code: 'INVALID_STORY_MEDIA' };
  }
  if (!['public', 'followers'].includes(visibility)) {
    throw { status: 400, message: 'رؤية القصة غير صالحة', code: 'INVALID_STORY_VISIBILITY' };
  }
  if (caption !== undefined && caption !== null &&
      (typeof caption !== 'string' || caption.trim().length > 280)) {
    throw { status: 400, message: 'وصف القصة لا يتجاوز 280 حرف', code: 'INVALID_STORY_CAPTION' };
  }

  const media = await query(
    `SELECT id, user_id, type, url FROM media WHERE id = $1`,
    [mediaId]
  );
  if (!media.rows.length || media.rows[0].user_id !== userId) {
    throw { status: 403, message: 'الوسيط غير تابع لك', code: 'STORY_MEDIA_FORBIDDEN' };
  }
  if (!['image', 'video', 'gif'].includes(media.rows[0].type)) {
    throw { status: 400, message: 'نوع الوسيط غير مدعوم للقصص', code: 'INVALID_STORY_MEDIA_TYPE' };
  }

  const active = await query(
    `SELECT COUNT(*)::int AS total
     FROM stories WHERE user_id = $1 AND expires_at > NOW()`,
    [userId]
  );
  if (active.rows[0].total >= MAX_ACTIVE_STORIES) {
    throw { status: 409, message: 'وصلت للحد الأقصى للقصص النشطة', code: 'STORY_LIMIT_REACHED' };
  }

  const result = await query(
    `INSERT INTO stories (user_id, media_id, caption, visibility, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
     RETURNING id, user_id, media_id, caption, visibility, expires_at, created_at`,
    [userId, mediaId, caption?.trim() || null, visibility]
  );
  return { ...result.rows[0], media: media.rows[0] };
}

async function listStories(userId) {
  const result = await query(
    `SELECT
       s.id, s.user_id, s.caption, s.visibility, s.expires_at, s.created_at,
       m.id AS media_id, m.url, m.type,
       u.username, u.display_name, u.avatar_url,
       EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = $1) AS viewed_by_me
     FROM stories s
     JOIN media m ON m.id = s.media_id
     JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > NOW()
       AND u.is_banned = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks b
         WHERE (b.blocker_id = $1 AND b.blocked_id = s.user_id)
            OR (b.blocker_id = s.user_id AND b.blocked_id = $1)
       )
       AND (
         s.user_id = $1
         OR s.visibility = 'public'
         OR (s.visibility = 'followers' AND EXISTS (
           SELECT 1 FROM follows f
           WHERE f.follower_id = $1 AND f.following_id = s.user_id
         ))
       )
     ORDER BY s.created_at ASC
     LIMIT 500`,
    [userId]
  );

  const grouped = new Map();
  for (const story of result.rows) {
    if (!grouped.has(story.user_id)) {
      grouped.set(story.user_id, {
        userId: story.user_id,
        username: story.username,
        displayName: story.display_name,
        avatarUrl: story.avatar_url,
        stories: [],
      });
    }
    grouped.get(story.user_id).stories.push({
      id: story.id,
      caption: story.caption,
      visibility: story.visibility,
      expiresAt: story.expires_at,
      createdAt: story.created_at,
      viewedByMe: story.viewed_by_me,
      media: { id: story.media_id, url: story.url, type: story.type },
    });
  }
  return Array.from(grouped.values());
}

async function getStory(storyId, viewerId) {
  const story = await assertStoryAccess(storyId, viewerId);
  if (story.user_id !== viewerId) {
    await query(
      `INSERT INTO story_views (story_id, viewer_id)
       VALUES ($1, $2) ON CONFLICT (story_id, viewer_id)
       DO UPDATE SET viewed_at = NOW()`,
      [storyId, viewerId]
    );
  }
  const views = await query(
    `SELECT COUNT(*)::int AS count FROM story_views WHERE story_id = $1`,
    [storyId]
  );
  return { ...story, viewCount: views.rows[0].count };
}

async function deleteStory(storyId, userId) {
  const result = await query(
    `DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id`,
    [storyId, userId]
  );
  if (!result.rows.length) throw { status: 404, message: 'القصة غير موجودة', code: 'STORY_NOT_FOUND' };
  return true;
}

async function cleanupExpiredStories() {
  const result = await query(
    `DELETE FROM stories WHERE expires_at <= NOW()`
  );
  return result.rowCount || 0;
}

module.exports = {
  STORY_TTL_MS,
  createStory,
  listStories,
  getStory,
  deleteStory,
  cleanupExpiredStories,
};
