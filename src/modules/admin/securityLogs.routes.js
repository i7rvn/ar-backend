const express = require('express');
const router = express.Router();
const { adminAuthenticate } = require('../../middleware/adminAuth');
const { requirePermission } = require('../../middleware/requirePermission');
const { PERMISSIONS } = require('../../utils/permissions');
const { query } = require('../../config/database');

router.use(adminAuthenticate);

router.get('/', requirePermission(PERMISSIONS.SECURITY_VIEW), async (req, res) => {
 const { severity, limit = 50 } = req.query;
 const params = [];
 let where = '';
 if (severity) { params.push(severity); where = `WHERE severity = $1`; }
 params.push(parseInt(limit));

 const result = await query(
 `SELECT * FROM security_logs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
 params
 );
 res.json({ success: true, logs: result.rows });
});

router.post('/block-ip', requirePermission(PERMISSIONS.SECURITY_BLOCK_IP), async (req, res) => {
 const { ip, reason } = req.body;
 await query(
 `INSERT INTO blocked_ips (ip_address, reason) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
 [ip, reason]
 );
 res.json({ success: true, message: `تم حظر IP: ${ip}` });
});

module.exports = router;
