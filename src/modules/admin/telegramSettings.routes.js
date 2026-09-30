// ═══════════════════════════════════════════════════════════════
// AR App — Admin: تفعيل/تعطيل تنبيهات بوت Telegram
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { getSetting, updateSetting } = require('../../config/settings');
const { logAdminAction } = require('../../utils/auditLog');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
  const [dbErrors, intrusionAttempts, general] = await Promise.all([
    getSetting('telegram_alert_db_errors', true),
    getSetting('telegram_alert_intrusion_attempts', true),
    getSetting('telegram_alert_general', false),
  ]);
  res.json({
    success: true,
    data: {
      // نتحقق فقط من وجود متغيرات البيئة — بلا أي طلب فعلي لـ Telegram API
      connected: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      alerts: { dbErrors, intrusionAttempts, general },
    },
  });
});

router.put('/', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res) => {
  const { alerts = {} } = req.body;
  const map = {
    dbErrors: 'telegram_alert_db_errors',
    intrusionAttempts: 'telegram_alert_intrusion_attempts',
    general: 'telegram_alert_general',
  };

  for (const [field, key] of Object.entries(map)) {
    if (typeof alerts[field] === 'boolean') {
      await updateSetting(key, alerts[field], req.admin.id);
    }
  }

  await logAdminAction({ adminId: req.admin.id, action: 'telegram_settings.update', afterData: alerts, req });
  res.json({ success: true, message: 'تم التحديث' });
});

module.exports = router;
