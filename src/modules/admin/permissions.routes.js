const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');
const { deleteCache } = require('../../config/redis');
const { logAuditAction } = require('./admin.service');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.PERMISSIONS_MANAGE), async (req, res) => {
 const result = await query(`SELECT id, key, module, description FROM permissions ORDER BY module`);
 res.json({ success: true, permissions: result.rows });
});

router.get('/roles', requirePermission(PERMISSIONS.PERMISSIONS_MANAGE), async (req, res) => {
 const result = await query(
 `SELECT r.id, r.name, ARRAY_AGG(p.key) AS permissions
 FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
 LEFT JOIN permissions p ON p.id = rp.permission_id
 GROUP BY r.id, r.name`
 );
 res.json({ success: true, roles: result.rows });
});

// تعديل صلاحيات دور معيّن (استبدال كامل بالمصفوفة الجديدة)
router.put('/roles/:roleId', requirePermission(PERMISSIONS.PERMISSIONS_MANAGE), async (req, res) => {
 const { permissionKeys } = req.body; // مثال: ['users.ban', 'posts.delete']

 await query(`DELETE FROM role_permissions WHERE role_id = $1`, [req.params.roleId]);
 for (const key of permissionKeys) {
 await query(
 `INSERT INTO role_permissions (role_id, permission_id)
 SELECT $1, id FROM permissions WHERE key = $2`,
 [req.params.roleId, key]
 );
 }

 // تفريغ كاش كل الأدمنز اللي عندهم هذا الدور (تحديث فوري)
 const admins = await query(`SELECT id FROM admins WHERE role_id = $1`, [req.params.roleId]);
 for (const a of admins.rows) await deleteCache(`admin_perms:${a.id}`);

 await logAuditAction(req.admin.id, 'permissions.update', 'role', req.params.roleId, null, req.body, req.ip);
 res.json({ success: true, message: 'تم تحديث صلاحيات الدور' });
});

module.exports = router;
