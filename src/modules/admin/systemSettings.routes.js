const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { updateSetting } = require('../../config/settings');
const { logAdminAction } = require('../../utils/auditLog');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
  const result = await query(
    `SELECT s.key, s.value, s.category, s.label, s.description, s.updated_at,
            u.username AS updated_by_username
     FROM system_settings s
     LEFT JOIN admins a ON a.id = s.updated_by
     LEFT JOIN users u ON u.id = a.user_id
     WHERE s.category IS DISTINCT FROM 'telegram'
     ORDER BY s.category, s.key`
  );
  res.json({
    success: true,
    data: result.rows.map((r) => ({
      key: r.key,
      // value مخزَّنة JSONB — قيم نصية بسيطة تُرجَّع كنص للحقل بالواجهة
      value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value),
      category: r.category || 'general',
      label: r.label || r.key,
      updatedByUsername: r.updated_by_username,
      updatedAt: r.updated_at,
    })),
  });
});

router.put('/:key', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
  const before = await query('SELECT value FROM system_settings WHERE key = $1', [req.params.key]);
  await updateSetting(req.params.key, req.body.value, req.admin.id);
  await logAdminAction({
    adminId: req.admin.id, action: 'setting.update', targetType: 'system_setting', targetId: req.params.key,
    beforeData: { value: before.rows[0]?.value }, afterData: { value: req.body.value }, req,
  });
  res.json({ success: true, message: 'تم تحديث الإعداد' });
});

router.get('/history/:key', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
  const result = await query(
    `SELECT * FROM settings_history WHERE key = $1 ORDER BY changed_at DESC LIMIT 50`,
    [req.params.key]
  );
  res.json({ success: true, history: result.rows });
});

module.exports = router;
