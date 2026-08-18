const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');

router.use(adminAuthenticate);

// فلترة: admin_id, action, from, to
router.get('/', requirePermission(PERMISSIONS.AUDIT_VIEW), async (req, res) => {
 const { adminId, action, from, to, limit = 50 } = req.query;
 const conditions = [];
 const params = [];

 if (adminId) { params.push(adminId); conditions.push(`admin_id = $${params.length}`); }
 if (action) { params.push(`%${action}%`); conditions.push(`action ILIKE $${params.length}`); }
 if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
 if (to) { params.push(to); conditions.push(`created_at <= $${params.length}`); }

 const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
 params.push(parseInt(limit));

 const result = await query(
 `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
 params
 );
 res.json({ success: true, logs: result.rows });
});

module.exports = router;
