const { query } = require('../../config/database');

async function logActivity(userId, action, req, details = {}) {
 await query(
 `INSERT INTO activity_history (user_id, action, ip_address, details)
 VALUES ($1, $2, $3, $4)`,
 [userId, action, req?.ip || null, JSON.stringify(details)]
 );
}

async function getActivityHistory(userId, limit = 50) {
 const result = await query(
 `SELECT action, ip_address, details, created_at
 FROM activity_history WHERE user_id = $1
 ORDER BY created_at DESC LIMIT $2`,
 [userId, limit]
 );
 return result.rows;
}

module.exports = { logActivity, getActivityHistory };
