// ═══════════════════════════════════════════════════════════════
// AR App — دالة موحّدة لتسجيل أي إجراء إداري بـ audit_logs
// تُستعمل بكل route إداري ينفّذ تغييراً (حظر، حذف، تعديل إعداد...)
// ═══════════════════════════════════════════════════════════════

const { query } = require('../config/database');
const logger = require('../config/logger');

/**
 * @param {object} params
 * @param {string} params.adminId
 * @param {string} params.action - مثال: 'user.ban', 'post.delete'
 * @param {string} [params.targetType] - مثال: 'user', 'post', 'community'
 * @param {string} [params.targetId]
 * @param {object} [params.beforeData]
 * @param {object} [params.afterData]
 * @param {import('express').Request} params.req - لاستخراج IP وUser-Agent
 */
async function logAdminAction({ adminId, action, targetType, targetId, beforeData, afterData, req }) {
  try {
    await query(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, before_data, after_data, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        adminId, action, targetType || null, targetId || null,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
        req?.ip || null, req?.headers?.['user-agent'] || null,
      ]
    );
  } catch (err) {
    // تسجيل الإجراء بروحه ما يوقّفش الطلب لو فشل — بس نسجّل بالـ logger
    logger.error('فشل تسجيل audit_logs:', err);
  }
}

module.exports = { logAdminAction };
