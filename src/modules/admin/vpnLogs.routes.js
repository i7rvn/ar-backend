// ═══════════════════════════════════════════════════════════════
// AR App — Admin: محاولات VPN المحجوبة + حظر IP دائم
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { logAdminAction } = require('../../utils/auditLog');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.SECURITY_EVENTS_VIEW), async (req, res) => {
  const { reason, page = 1, limit = 25 } = req.query;
  const lim = Math.min(parseInt(limit) || 25, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  const result = await query(
    `SELECT id, ip_address, reason, blocked_at
     FROM vpn_logs
     WHERE ($1::text IS NULL OR reason = $1)
     ORDER BY blocked_at DESC
     LIMIT $2 OFFSET $3`,
    [reason || null, lim + 1, offset]
  );

  const hasMore = result.rows.length > lim;
  res.json({
    success: true,
    data: result.rows.slice(0, lim).map((r) => ({
      ipAddress: r.ip_address, reason: r.reason, createdAt: r.blocked_at,
    })),
    page: parseInt(page) || 1,
    hasMore,
  });
});

router.post('/:ip/block-permanent', requirePermission(PERMISSIONS.TRUSTED_IPS_MANAGE), async (req, res) => {
  const ip = req.params.ip;
  await query(
    `INSERT INTO blocked_ips (ip_address, reason, blocked_until)
     VALUES ($1, $2, NULL)
     ON CONFLICT (ip_address) DO UPDATE SET reason = $2, blocked_until = NULL`,
    [ip, `حظر يدوي من الداشبورد — ${req.admin.id}`]
  );
  await logAdminAction({ adminId: req.admin.id, action: 'ip.block_permanent', afterData: { ip }, req });
  res.json({ success: true, message: `تم حظر ${ip} بشكل دائم` });
});

module.exports = router;
