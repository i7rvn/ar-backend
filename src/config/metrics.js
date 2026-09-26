// ═══════════════════════════════════════════════════════════════
// AR App — مقاييس داخلية خفيفة (بدون Prometheus/Grafana)
//
// ملاحظة تصميمية: تم استبدال prom-client بعدّادات داخلية بالذاكرة
// لأن هدف هذا الإصدار تشغيل الخادم على منصة استضافة مجانية واحدة
// بلا خدمات مراقبة خارجية منفصلة. النتيجة أبسط وتُدرَج مباشرة
// بنقطة الفحص /api/health، وتكفي لمشروع بهذا الحجم.
// ═══════════════════════════════════════════════════════════════

const startedAt = Date.now();

const counters = {
  httpRequestsTotal: 0,
  httpErrorsTotal: 0,
  postsTotal: 0,
  activeUsers: 0,
};

const routeStats = new Map(); // "METHOD path" -> { count, totalDurationMs }

function recordRequest(method, route, status, durationMs) {
  counters.httpRequestsTotal += 1;
  if (status >= 500) counters.httpErrorsTotal += 1;

  const key = `${method} ${route}`;
  const current = routeStats.get(key) || { count: 0, totalDurationMs: 0 };
  current.count += 1;
  current.totalDurationMs += durationMs;
  routeStats.set(key, current);
}

// ─── Middleware Express: يُسجَّل تلقائياً على كل طلب ───────────
function metricsMiddleware(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const route = req.route?.path || req.path || 'unknown';
    recordRequest(req.method, route, res.statusCode, durationMs);
  });
  next();
}

// ─── تحديث مقاييس تعتمد على استعلام قاعدة البيانات ─────────────
async function updateDBMetrics(query) {
  try {
    const result = await query('SELECT COUNT(*) FROM posts');
    counters.postsTotal = parseInt(result.rows[0].count, 10) || 0;
  } catch {
    // فشل التحديث لا يوقف الخادم، نتجاوزه بصمت وننتظر الدورة القادمة
  }
}

function setActiveUsers(count) {
  counters.activeUsers = count;
}

// ─── ملخص المقاييس (نص عادي، يُقرأ بسهولة بلا Prometheus) ──────
function metricsHandler(req, res) {
  const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const routes = Array.from(routeStats.entries()).map(([key, stats]) => ({
    route: key,
    requests: stats.count,
    averageDurationMs: Math.round(stats.totalDurationMs / stats.count),
  }));

  res.json({
    uptimeSeconds,
    httpRequestsTotal: counters.httpRequestsTotal,
    httpErrorsTotal: counters.httpErrorsTotal,
    postsTotal: counters.postsTotal,
    activeUsers: counters.activeUsers,
    byRoute: routes,
  });
}

module.exports = { metricsMiddleware, updateDBMetrics, metricsHandler, setActiveUsers };
