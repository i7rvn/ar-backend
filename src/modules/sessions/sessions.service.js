const { query } = require('../../config/database');
const { blacklistToken } = require('../../config/redis');

async function listUserDevices(userId) {
  const result = await query(
    `SELECT id, device_name, device_type, ip_address, last_seen_at, is_current
     FROM sessions_devices WHERE user_id = $1 ORDER BY last_seen_at DESC`,
    [userId]
  );
  return result.rows;
}

// مدة إبطال افتراضية عند عدم معرفة الصلاحية المتبقية للتوكن بدقة -
// تطابق أقصى عمر ممكن لتوكن الدخول (JWT_EXPIRES_IN)
const DEFAULT_BLACKLIST_SECONDS = 7 * 24 * 3600;

async function revokeDevice(userId, deviceId) {
  const device = await query(
    `SELECT access_token FROM sessions_devices WHERE id = $1 AND user_id = $2`,
    [deviceId, userId]
  );

  await query(
    `DELETE FROM sessions_devices WHERE id = $1 AND user_id = $2`,
    [deviceId, userId]
  );

  // إبطال التوكن الفعلي المخزَّن لهذا الجهاز - بدون هذا، الجهاز يبقى
  // مسجَّل الدخول فعلياً حتى تنتهي صلاحية توكنه طبيعياً
  if (device.rows[0]?.access_token) {
    await blacklistToken(device.rows[0].access_token, DEFAULT_BLACKLIST_SECONDS);
  }
}

async function revokeAllDevicesExceptCurrent(userId) {
  const current = await query(
    `SELECT id FROM sessions_devices WHERE user_id = $1 AND is_current = TRUE LIMIT 1`,
    [userId]
  );
  const currentDeviceId = current.rows[0]?.id || null;

  const otherDevices = await query(
    `SELECT access_token FROM sessions_devices WHERE user_id = $1 AND id IS DISTINCT FROM $2`,
    [userId, currentDeviceId]
  );

  for (const row of otherDevices.rows) {
    if (row.access_token) {
      await blacklistToken(row.access_token, DEFAULT_BLACKLIST_SECONDS);
    }
  }

  await query(
    `DELETE FROM sessions_devices WHERE user_id = $1 AND id IS DISTINCT FROM $2`,
    [userId, currentDeviceId]
  );
}

module.exports = { listUserDevices, revokeDevice, revokeAllDevicesExceptCurrent };
