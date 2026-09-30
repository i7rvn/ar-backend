// ═══════════════════════════════════════════════════════════════
// AR App — البلاغات، مع ترتيب حسب الخطورة بدل الترتيب الزمني وحده
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { reportLimiter } = require('../../middleware/rateLimit');

const { logAdminAction } = require('../../utils/auditLog');

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
router.post('/', authenticate, reportLimiter, async (req, res) => {
  const { reportedUserId, reportedPostId, reason, details } = req.body;

  if (!reportedUserId && !reportedPostId) {
    return res.status(400).json({ success: false, message: 'حدّد المستخدم أو المنشور المبلَّغ عنه' });
  }
  if (!reason) {
    return res.status(400).json({ success: false, message: 'سبب البلاغ مطلوب' });
  }
  // التحقق من الخادم ماشي من الواجهة: السبب لازم يكون من القائمة المعرّفة
  // فعلاً (بلا هذا أي نص عشوائي كان يتخزّن ويلخبط ترتيب الخطورة)
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_WEIGHTS, reason)) {
    return res.status(400).json({ success: false, message: 'سبب البلاغ غير صالح' });
  }
  if (details && (typeof details !== 'string' || details.length > 500)) {
    return res.status(400).json({ success: false, message: 'التفاصيل لا تتجاوز 500 حرف' });
  }
  if (reportedUserId && reportedUserId === req.user.id) {
    return res.status(400).json({ success: false, message: 'لا يمكنك الإبلاغ عن نفسك' });
  }

  const severityWeight = SEVERITY_WEIGHTS[reason] || 1;

  await query(
    `INSERT INTO reports (reporter_id, reported_user_id, reported_post_id, reason, details, severity_weight)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.id, reportedUserId || null, reportedPostId || null, reason, details || null, severityWeight]
  );

  res.status(201).json({ success: true, message: 'تم استلام البلاغ' });
});

// ─── قائمة البلاغات للإدارة، مرتّبة حسب الخطورة (من الخادم مباشرة) ──
router.get('/', adminAuthenticate, requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const lim = Math.min(parseInt(limit) || 20, 100);
  const offset = (Math.max(parseInt(page) || 1, 1) - 1) * lim;

  const result = await query(
    `SELECT rr.*, ru.username AS reported_username,
            rp.content AS reported_post_content, pu.username AS reported_post_author_username
     FROM reports_ranked rr
     LEFT JOIN users ru ON ru.id = rr.reported_user_id
     LEFT JOIN posts rp ON rp.id = rr.reported_post_id
     LEFT JOIN users pu ON pu.id = rp.user_id
     ORDER BY rr.priority_score DESC, rr.created_at DESC
     LIMIT $1 OFFSET $2`,
    [lim + 1, offset]
  );

  const hasMore = result.rows.length > lim;
  res.json({
    success: true,
    data: result.rows.slice(0, lim).map((r) => ({
      id: r.id,
      targetType: r.reported_post_id ? 'post' : 'user',
      targetUsername: r.reported_username,
      targetAuthorUsername: r.reported_post_author_username,
      reason: r.reason,
      similarCount: r.related_reports_count,
      lastReportedAt: r.created_at,
      createdAt: r.created_at,
    })),
    page: parseInt(page) || 1,
    hasMore,
  });
});

// ─── تحديث حالة بلاغ (قبول/رفض) ──────────────────────────────────
router.put('/:id', adminAuthenticate, requirePermission(PERMISSIONS.REPORTS_VIEW), async (req, res) => {
  const { action } = req.body; // 'accept' | 'reject' — يطابق واجهة الداشبورد
  const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : null;
  if (!status) {
    return res.status(400).json({ success: false, message: 'إجراء غير صالح' });
  }

  await query(
    `UPDATE reports SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE id = $3`,
    [status, req.admin.user_id, req.params.id]
  );
  await logAdminAction({
    adminId: req.admin.id, action: `report.${status === 'accepted' ? 'accept' : 'reject'}`,
    targetType: 'report', targetId: req.params.id, req,
  });
  res.json({ success: true, message: 'تم تحديث حالة البلاغ' });
});

module.exports = router;
