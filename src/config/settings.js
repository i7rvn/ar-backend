const { query } = require('./database');
const { setCache, getCache, deleteCache } = require('./redis');
const logger = require('./logger');

const CACHE_PREFIX = 'setting:';
const CACHE_TTL = 300; // 5 دقائق

// جلب قيمة إعداد — من الـ cache أولاً، وإلا من القاعدة
async function getSetting(key, fallback = null) {
 const cached = await getCache(CACHE_PREFIX + key);
 if (cached !== null) return cached;

 const result = await query('SELECT value FROM system_settings WHERE key = $1', [key]);
 if (result.rows.length === 0) return fallback;

 const value = result.rows[0].value;
 await setCache(CACHE_PREFIX + key, value, CACHE_TTL);
 return value;
}

// تعديل إعداد + تسجيل التاريخ + تفريغ الـ cache
async function updateSetting(key, newValue, adminId) {
 const before = await query('SELECT value FROM system_settings WHERE key = $1', [key]);
 const oldValue = before.rows[0]?.value ?? null;

 await query(
 `INSERT INTO system_settings (key, value, updated_by, updated_at)
 VALUES ($1, $2, $3, NOW())
 ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
 [key, JSON.stringify(newValue), adminId]
 );

 await query(
 `INSERT INTO settings_history (key, old_value, new_value, changed_by)
 VALUES ($1, $2, $3, $4)`,
 [key, JSON.stringify(oldValue), JSON.stringify(newValue), adminId]
 );

 await deleteCache(CACHE_PREFIX + key);
 logger.info(`إعداد "${key}" تم تعديله بواسطة الأدمن ${adminId}`);
}

module.exports = { getSetting, updateSetting };
