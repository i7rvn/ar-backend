// ═══════════════════════════════════════════════════════════════
// AR App — نقطة فحص الصحة
//
// ملاحظة تصميمية: لا تعتمد هذه النقطة على أي خدمة خارجية منفصلة
// (Go, Rust, Meilisearch) بعد أن أصبحت وظائفها جزءاً من نفس عملية
// Node.js. الفحص يبقى على PostgreSQL وRedis فقط، زائد حالة داخلية
// (اتصالات WebSocket، حالة Master Key).
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { pool } = require('../../config/database');
const { client: redisClient } = require('../../config/redis');
const { metricsHandler } = require('../../config/metrics');
const { getOnlineUserIds } = require('../../modules/websocket/server');
const { getSecurityStatus } = require('../../modules/ai-filter/security.client');

const router = express.Router();

// ─── فحص شامل ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const start = Date.now();
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    services: {},
  };

  try {
    const t = Date.now();
    await pool.query('SELECT 1');
    health.services.postgres = { status: 'ok', latency: `${Date.now() - t}ms` };
  } catch {
    health.services.postgres = { status: 'error' };
    health.status = 'degraded';
  }

  try {
    const t = Date.now();
    await redisClient.ping();
    health.services.redis = { status: 'ok', latency: `${Date.now() - t}ms` };
  } catch {
    health.services.redis = { status: 'error' };
    health.status = 'degraded';
  }

  try {
    health.services.websocket = { status: 'ok', connectedUsers: getOnlineUserIds().length };
  } catch {
    health.services.websocket = { status: 'error' };
  }

  try {
    const securityStatus = await getSecurityStatus();
    health.services.encryption = { status: 'ok', unlocked: securityStatus.unlocked };
  } catch {
    health.services.encryption = { status: 'error' };
  }

  health.totalLatency = `${Date.now() - start}ms`;
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// ─── مقاييس داخلية (بلا Prometheus) ─────────────────────────────
router.get('/metrics', metricsHandler);

module.exports = router;
