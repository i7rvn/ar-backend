// ═══════════════════════════════════════════════════════════════
// AR App — Admin: أكواد دعوة المغتربين (إعفاء جغرافي دائم لمرة تسجيل)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { adminLimiter } = require('../../middleware/rateLimit');
const { PERMISSIONS } = require('../../utils/permissions');
const { logAdminAction } = require('../../utils/auditLog');
const { sendAlert } = require('../../config/telegram');
const { generateInviteCode, revokeInviteCode, listInviteCodes } = require('../auth/inviteCodes.service');

const router = express.Router();
router.use(adminLimiter);
router.use(adminAuthenticate);

// ─── توليد كود جديد ────────────────────────────────────────────
router.post('/', requirePermission(PERMISSIONS.INVITE_CODES_CREATE), async (req, res) => {
  try {
    const { note, expiryHours } = req.body || {};
    const invite = await generateInviteCode(req.admin.id, note || null, expiryHours || undefined);

    await logAdminAction({
      adminId: req.admin.id,
      action: 'invite_code.create',
      targetType: 'invite_code',
      targetId: invite.id,
      afterData: { code: invite.code, expiresAt: invite.expires_at, note: note || null },
      req,
    });

    // تنبيه اختياري — عدد الاستثناءات قليل نسبياً، مراقبتها سهلة ومفيدة
    await sendAlert(`تم توليد كود دعوة مغتربين جديد بواسطة ${req.admin.role_name || req.admin.id}`, 'info').catch(() => {});

    res.status(201).json({ success: true, data: invite });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل توليد الكود', error: err.message });
  }
});

// ─── قائمة الأكواد (فلترة اختيارية: all/used/unused/expired) ────
router.get('/', requirePermission(PERMISSIONS.INVITE_CODES_VIEW), async (req, res) => {
  try {
    const { status = 'all', limit = 50, offset = 0 } = req.query;
    const codes = await listInviteCodes({ status, limit: Number(limit), offset: Number(offset) });
    res.json({ success: true, data: codes });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل جلب القائمة', error: err.message });
  }
});

// ─── إلغاء كود قبل استعماله (Revoke) ────────────────────────────
router.patch('/:id/revoke', requirePermission(PERMISSIONS.INVITE_CODES_REVOKE), async (req, res) => {
  try {
    const revoked = await revokeInviteCode(req.params.id, req.admin.id);
    if (!revoked) {
      return res.status(400).json({ success: false, message: 'الكود غير موجود، أو مُستعمَل/ملغى من قبل' });
    }

    await logAdminAction({
      adminId: req.admin.id,
      action: 'invite_code.revoke',
      targetType: 'invite_code',
      targetId: revoked.id,
      afterData: { code: revoked.code },
      req,
    });

    res.json({ success: true, data: revoked });
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل إلغاء الكود', error: err.message });
  }
});

module.exports = router;
