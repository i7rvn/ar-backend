// ═══════════════════════════════════════════════════════════════
// AR App — Admin: إدارة المجتمعات
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

router.get('/', requirePermission(PERMISSIONS.COMMUNITIES_VIEW), async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const lim = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  const result = await query(
    `SELECT c.id, c.name, c.members_count, c.is_private, c.created_at,
            u.username AS founder_username,
            (SELECT COUNT(*) FROM posts p WHERE p.community_id = c.id AND p.is_deleted = FALSE)::int AS posts_count
     FROM communities c
     LEFT JOIN users u ON u.id = c.created_by
     ORDER BY c.created_at DESC
     LIMIT $1 OFFSET $2`,
    [lim + 1, offset]
  );

  const hasMore = result.rows.length > lim;
  res.json({
    success: true,
    data: result.rows.slice(0, lim).map((c) => ({
      id: c.id, name: c.name, founderUsername: c.founder_username,
      membersCount: c.members_count, postsCount: c.posts_count,
      type: c.is_private ? 'closed' : 'public', createdAt: c.created_at,
    })),
    page: parseInt(page) || 1,
    hasMore,
  });
});

router.delete('/:id', requirePermission(PERMISSIONS.COMMUNITIES_DELETE), async (req, res) => {
  const before = await query('SELECT name FROM communities WHERE id = $1', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ success: false, message: 'غير موجود' });

  await query('DELETE FROM communities WHERE id = $1', [req.params.id]); // CASCADE يحذف المنشورات والعضويات

  await logAdminAction({
    adminId: req.admin.id, action: 'community.delete', targetType: 'community', targetId: req.params.id,
    beforeData: { name: before.rows[0].name }, req,
  });
  res.json({ success: true, message: 'تم حذف المجتمع' });
});

module.exports = router;
