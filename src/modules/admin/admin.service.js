const { query } = require('../../config/database');

// تسجيل موحّد لكل عملية أدمن — يُخزّن before/after كامل
async function logAuditAction(adminId, action, targetType, targetId, beforeData, afterData, ip) {
 await query(
 `INSERT INTO audit_logs (admin_id, action, target_type, target_id, before_data, after_data, ip_address)
 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
 [adminId, action, targetType, targetId, JSON.stringify(beforeData), JSON.stringify(afterData), ip]
 );
}

module.exports = { logAuditAction };
