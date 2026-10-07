// ═══════════════════════════════════════════════════════════════
// AR App — إحصائيات صانع المحتوى
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { query } = require('../../config/database');

const router = express.Router();
router.use(authenticate);

// ─── ملخص الإحصائيات لفترة قابلة للاختيار ────────────────────────
router.get('/', async (req, res) => {
  const days = parseInt(req.query.days) === 28 ? 28 : 7;
  const userId = req.user.id;

  const [impressions, previousImpressions, engagement, previousEngagement, profileVisits, previousProfileVisits, newFollowers, previousNewFollowers] =
    await Promise.all([
      query(
        `SELECT COUNT(*) FROM post_views pv JOIN posts p ON p.id = pv.post_id
         WHERE p.user_id = $1 AND pv.created_at >= NOW() - INTERVAL '1 day' * $2`,
        [userId, days]
      ),
      query(
        `SELECT COUNT(*) FROM post_views pv JOIN posts p ON p.id = pv.post_id
         WHERE p.user_id = $1 AND pv.created_at >= NOW() - INTERVAL '1 day' * $2 * 2
           AND pv.created_at < NOW() - INTERVAL '1 day' * $2`,
        [userId, days]
      ),
      query(
        `SELECT
           (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = $1 AND l.created_at >= NOW() - INTERVAL '1 day' * $2) +
           (SELECT COUNT(*) FROM reposts r JOIN posts p ON p.id = r.post_id WHERE p.user_id = $1 AND r.created_at >= NOW() - INTERVAL '1 day' * $2) +
           (SELECT COUNT(*) FROM posts WHERE reply_to_id IN (SELECT id FROM posts WHERE user_id = $1) AND created_at >= NOW() - INTERVAL '1 day' * $2)
           AS total`,
        [userId, days]
      ),
      query(
        `SELECT
           (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = $1 AND l.created_at >= NOW() - INTERVAL '1 day' * $2 * 2 AND l.created_at < NOW() - INTERVAL '1 day' * $2) +
           (SELECT COUNT(*) FROM reposts r JOIN posts p ON p.id = r.post_id WHERE p.user_id = $1 AND r.created_at >= NOW() - INTERVAL '1 day' * $2 * 2 AND r.created_at < NOW() - INTERVAL '1 day' * $2) +
           (SELECT COUNT(*) FROM posts WHERE reply_to_id IN (SELECT id FROM posts WHERE user_id = $1) AND created_at >= NOW() - INTERVAL '1 day' * $2 * 2 AND created_at < NOW() - INTERVAL '1 day' * $2)
           AS total`,
        [userId, days]
      ),
      query(
        `SELECT COUNT(*) FROM profile_views WHERE profile_user_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
        [userId, days]
      ),
      query(
        `SELECT COUNT(*) FROM profile_views WHERE profile_user_id = $1
           AND created_at >= NOW() - INTERVAL '1 day' * $2 * 2 AND created_at < NOW() - INTERVAL '1 day' * $2`,
        [userId, days]
      ),
      query(
        `SELECT COUNT(*) FROM follows WHERE following_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
        [userId, days]
      ),
      query(
        `SELECT COUNT(*) FROM follows WHERE following_id = $1
           AND created_at >= NOW() - INTERVAL '1 day' * $2 * 2 AND created_at < NOW() - INTERVAL '1 day' * $2`,
        [userId, days]
      ),
    ]);

  function withChange(current, previous) {
    const c = parseInt(current);
    const p = parseInt(previous);
    const change = p === 0 ? (c > 0 ? 100 : 0) : Math.round(((c - p) / p) * 100);
    return { value: c, changePercent: change };
  }

  const topPosts = await query(
    `SELECT p.id, p.content, p.likes_count, p.reposts_count, p.created_at,
       (SELECT COUNT(*) FROM post_views WHERE post_id = p.id) AS views_count
     FROM posts p
     WHERE p.user_id = $1 AND p.created_at >= NOW() - INTERVAL '1 day' * $2 AND p.is_deleted = FALSE
     ORDER BY p.likes_count DESC LIMIT 5`,
    [userId, days]
  );

  res.json({
    success: true,
    period: `${days}d`,
    impressions: withChange(impressions.rows[0].count, previousImpressions.rows[0].count),
    engagement: withChange(engagement.rows[0].total, previousEngagement.rows[0].total),
    profileVisits: withChange(profileVisits.rows[0].count, previousProfileVisits.rows[0].count),
    newFollowers: withChange(newFollowers.rows[0].count, previousNewFollowers.rows[0].count),
    topPosts: topPosts.rows,
  });
});

module.exports = router;
