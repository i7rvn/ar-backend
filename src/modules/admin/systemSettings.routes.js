const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { updateSetting } = require('../../config/settings');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
 const result = await query(`SELECT key, value, description, updated_at FROM system_settings ORDER BY key`);
 res.json({ success: true, settings: result.rows });
});

router.put('/:key', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
 await updateSetting(req.params.key, req.body.value, req.admin.id);
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
