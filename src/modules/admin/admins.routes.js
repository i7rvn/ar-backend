const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { logAuditAction } = require('./admin.service');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.ADMINS_CREATE), async (req, res) => {
 const result = await query(
 `SELECT a.id, a.is_owner, r.name AS role, u.username, u.email
 FROM admins a JOIN users u ON u.id = a.user_id LEFT JOIN roles r ON r.id = a.role_id`
 );
 res.json({ success: true, admins: result.rows });
});

router.post('/', requirePermission(PERMISSIONS.ADMINS_CREATE), async (req, res) => {
 const { userId, roleId } = req.body;
 const inserted = await query(
 `INSERT INTO admins (user_id, role_id, created_by) VALUES ($1, $2, $3) RETURNING id`,
 [userId, roleId, req.admin.id]
 );
 await logAuditAction(req.admin.id, 'admin.create', 'admin', inserted.rows[0].id, null, req.body, req.ip);
 res.status(201).json({ success: true, adminId: inserted.rows[0].id });
});

router.delete('/:id', requirePermission(PERMISSIONS.ADMINS_DELETE), async (req, res) => {
 const before = await query(`SELECT * FROM admins WHERE id = $1`, [req.params.id]);
 if (before.rows[0]?.is_owner) {
 return res.status(403).json({ success: false, message: 'لا يمكن حذف الـ Owner', code: 'CANNOT_DELETE_OWNER' });
 }
 await query(`DELETE FROM admins WHERE id = $1`, [req.params.id]);
 await logAuditAction(req.admin.id, 'admin.delete', 'admin', req.params.id, before.rows[0], null, req.ip);
 res.json({ success: true, message: 'تم حذف الأدمن' });
});

module.exports = router;
