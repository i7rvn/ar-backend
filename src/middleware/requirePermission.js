const { query } = require('../config/database');
const { setCache, getCache } = require('../config/redis');
const logger = require('../config/logger');

const CACHE_TTL = 300; // 5 دقائق

// يجلب كل صلاحيات الأدمن (من دوره) — مع كاش بالـ Redis
async function getAdminPermissions(adminId) {
 const cacheKey = `admin_perms:${adminId}`;
 const cached = await getCache(cacheKey);
 if (cached) return cached;

 const result = await query(
 `SELECT p.key FROM admins a
 JOIN role_permissions rp ON rp.role_id = a.role_id
 JOIN permissions p ON p.id = rp.permission_id
 WHERE a.id = $1`,
 [adminId]
 );

 const perms = result.rows.map(r => r.key);
 await setCache(cacheKey, perms, CACHE_TTL);
 return perms;
}

// middleware ديناميكي: requirePermission('users.ban')
function requirePermission(permissionKey) {
 return async (req, res, next) => {
 try {
 const admin = req.admin; // يُفترض adminAuth مرّ قبل هذا middleware
 if (!admin) {
 return res.status(401).json({ success: false, message: 'دخول أدمن مطلوب', code: 'NO_ADMIN' });
 }

 if (admin.is_owner) return next(); // الـ Owner يتجاوز كل شيء

 const perms = await getAdminPermissions(admin.id);
 const allowed = perms.includes('*') || perms.includes(permissionKey);

 if (!allowed) {
 return res.status(403).json({
 success: false,
 message: 'ما عندكش الصلاحية المطلوبة لهذي العملية',
 code: 'PERMISSION_DENIED',
 required: permissionKey,
 });
 }
 next();
 } catch (err) {
 logger.error('خطأ requirePermission:', err);
 return res.status(500).json({ success: false, message: 'خطأ في فحص الصلاحيات' });
 }
 };
}

module.exports = { requirePermission, getAdminPermissions };
