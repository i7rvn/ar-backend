// ═══════════════════════════════════════════════════════════════
// AR App — البلاغات، مع ترتيب حسب الخطورة بدل الترتيب الزمني وحده
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');

const router = express.Router();

// وزن الخطورة حسب نوع المخالفة، يُستخدم بترتيب البلاغات بالداشبورد
const SEVERITY_WEIGHTS = {
  spam: 1,
  harassment: 3,
  hate_speech: 4,
  violence: 5,
  nudity: 4,
  impersonation: 2,
  other: 1,
};

// ─── إنشاء بلاغ (أي مستخدم مسجّل) ────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { reportedUserId, reportedPostId, reason, details } = req.body;

  if (!reportedUserId && !reportedPostId) {
    return res.status(400).json({ success: false, message: 'حدّد المستخدم أو المنشور المبلَّغ عنه' });
  }
  if (!reason) {
    return res.status(400).json({ success: false, message: 'سبب البلاغ مطلوب' });
  }

  const severityWeight = SEVERITY_WEIGHTS[reason] || 1;

  await query(
    `INSERT INTO reports (reporter_id, reported_user_id, reported_post_id, reason, details, severity_weight)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.id, reportedUserId || null, reportedPostId || null, reason, details || null, severityWeight]
  );

  res.status(201).json({ success: true, message: 'تم استلام البلاغ' });
});

// ─── قائمة البلاغات للإدارة، مرتّبة حسب الخطورة ──────────────────
router.get('/', adminAuthenticate, requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const { limit = 50 } = req.query;
  const result = await query(
    `SELECT * FROM reports_ranked ORDER BY priority_score DESC, created_at DESC LIMIT $1`,
    [parseInt(limit)]
  );
  res.json({ success: true, reports: result.rows });
});

// ─── تحديث حالة بلاغ (قبول/رفض) ──────────────────────────────────
router.put('/:id', adminAuthenticate, requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, message: 'حالة غير صالحة' });
  }
  await query(
    `UPDATE reports SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE id = $3`,
    [status, req.admin.user_id, req.params.id]
  );
  res.json({ success: true, message: 'تم تحديث حالة البلاغ' });
});

module.exports = router;
