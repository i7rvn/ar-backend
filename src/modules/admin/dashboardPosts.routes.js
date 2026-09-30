// ═══════════════════════════════════════════════════════════════
// AR App — Admin: إدارة المنشورات
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { adminLimiter } = require('../../middleware/rateLimit');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { logAdminAction } = require('../../utils/auditLog');

const router = express.Router();
router.use(adminLimiter);
router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.POSTS_VIEW), async (req, res) => {
  const { reportedOnly, page = 1, limit = 20 } = req.query;
  const lim = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  const baseQuery = reportedOnly === 'true'
    ? `SELECT p.id, p.content, p.created_at, u.username AS author_username,
              COUNT(r.id)::int AS reports_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       JOIN reports r ON r.reported_post_id = p.id AND r.status = 'pending'
       WHERE p.is_deleted = FALSE
       GROUP BY p.id, u.username
       ORDER BY reports_count DESC, p.created_at DESC
       LIMIT $1 OFFSET $2`
    : `SELECT p.id, p.content, p.created_at, u.username AS author_username,
              (SELECT COUNT(*) FROM reports r WHERE r.reported_post_id = p.id AND r.status = 'pending')::int AS reports_count
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.is_deleted = FALSE
       ORDER BY p.created_at DESC
       LIMIT $1 OFFSET $2`;

  const result = await query(baseQuery, [lim + 1, offset]);
  const hasMore = result.rows.length > lim;
  res.json({
    success: true,
    data: result.rows.slice(0, lim).map((p) => ({
      id: p.id, content: p.content, authorUsername: p.author_username,
      reportsCount: p.reports_count, createdAt: p.created_at,
    })),
    page: parseInt(page) || 1,
    hasMore,
  });
});

router.delete('/:id', requirePermission(PERMISSIONS.POSTS_DELETE), async (req, res) => {
  const { reason } = req.body;
  const before = await query('SELECT user_id, content FROM posts WHERE id = $1', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ success: false, message: 'المنشور غير موجود' });

  await query('UPDATE posts SET is_deleted = TRUE WHERE id = $1', [req.params.id]);
  await logAdminAction({
    adminId: req.admin.id, action: 'post.delete', targetType: 'post', targetId: req.params.id,
    beforeData: { authorId: before.rows[0].user_id }, afterData: { reason: reason || null }, req,
  });
  res.json({ success: true, message: 'تم حذف المنشور' });
});

module.exports = router;
