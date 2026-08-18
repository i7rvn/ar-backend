// ═══════════════════════════════════════════════════════════════
// AR App — الخادم الرئيسي
//
// ملاحظة تصميمية: هذا الإصدار مبسّط عمداً إلى خدمة Node.js واحدة
// (زائد PostgreSQL وRedis) بلا خدمات Go أو Rust أو Meilisearch أو
// Prometheus/Grafana منفصلة، لتسهيل تشغيله بالكامل على استضافة
// مجانية واحدة. الوظائف التي كانت بتلك الخدمات (WebSocket، التشفير،
// البحث، المقاييس) منقولة لنفس عملية Node.js.
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();

const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const { connectDB } = require('./config/database');
const { connectRedis } = require('./config/redis');
const logger = require('./config/logger');
const { startCronJobs } = require('./config/cron');
const { startQueueWorkers } = require('./config/queueWorkers');
const { globalLimiter } = require('./middleware/rateLimit');
const { vpnGuard } = require('./middleware/vpn');
const { metricsMiddleware, updateDBMetrics, setActiveUsers } = require('./config/metrics');
const { requireClientKey } = require('./middleware/clientAuth');
const { attachWebSocketServer, getOnlineUserIds } = require('./modules/websocket/server');

// ─── Routes ───────────────────────────────────────────────────
const authRoutes = require('./modules/auth/auth.routes');
const userRoutes = require('./modules/users/users.routes');
const healthRoutes = require('./modules/health/health.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const postsRoutes = require('./modules/posts/posts.routes');
const feedRoutes = require('./modules/feed/feed.routes');
const followsRoutes = require('./modules/follows/follows.routes');
const hashtagsRoutes = require('./modules/hashtags/hashtags.routes');
const searchRoutes = require('./modules/search/search.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const mediaRoutes = require('./modules/media/media.routes');
const messagesRoutes = require('./modules/messages/messages.routes');

// ─── Routes إضافية (RBAC، 2FA، الأجهزة، الإدارة المتقدمة) ──────
const twofaRoutes = require('./modules/twofa/twofa.routes');
const sessionsRoutes = require('./modules/sessions/sessions.routes');
const adminAuthRoutes = require('./modules/admin/admin.auth.routes');
const adminAdminsRoutes = require('./modules/admin/admins.routes');
const adminPermissionsRoutes = require('./modules/admin/permissions.routes');
const adminAuditLogRoutes = require('./modules/admin/auditLog.routes');
const adminSecurityRoutes = require('./modules/admin/securityLogs.routes');
const adminSettingsRoutes = require('./modules/admin/systemSettings.routes');
const blocksRoutes = require('./modules/blocks/blocks.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const usernameRoutes = require('./modules/users/username.routes');
const accountRoutes = require('./modules/users/account.routes');
const encryptionSectionsRoutes = require('./modules/admin/encryption.routes');
const notificationPreferencesRoutes = require('./modules/notifications/preferences.routes');
const communitiesRoutes = require('./modules/communities/communities.routes');
const statsRoutes = require('./modules/stats/stats.routes');

const { query } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// لا تخزين مؤقت للاستجابات بالمتصفح افتراضياً - يمنع تسريب بيانات
// حساسة (رسائل، إشعارات، بيانات حساب) عبر cache متصفح مشترك
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Key'],
}));

app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan('combined', { stream: { write: (m) => logger.info(m.trim()) } }));

// ─── قياس الأداء الداخلي (بلا Prometheus) ──────────────────────
app.use(metricsMiddleware);

// ─── فحص الصحة يبقى متاحاً بلا مفتاح عميل (تحتاجه منصة الاستضافة) ──
app.use('/api/health', healthRoutes);

// ─── مفتاح العميل + Rate Limiting + VPN ────────────────────────
app.use('/api/', requireClientKey);
app.use('/api/', globalLimiter);
app.use('/api/', vpnGuard);

// ─── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// المسارات الإدارية الأكثر تحديداً يجب أن تُسجَّل قبل المسار العام
// /api/admin، لأن Express يطابق المسارات بترتيب التسجيل: لو سُجِّل
// /api/admin أولاً، فـ router.use(requireAdmin) بداخله يعترض أي طلب
// يبدأ بـ /api/admin (بما فيها /api/admin/auth وغيرها) قبل ما توصل
// حتى لهذه الروابط المتخصصة أدناه.
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/admins', adminAdminsRoutes);
app.use('/api/admin/permissions', adminPermissionsRoutes);
app.use('/api/admin/audit-logs', adminAuditLogRoutes);
app.use('/api/admin/security-logs-v2', adminSecurityRoutes);
app.use('/api/admin/settings', adminSettingsRoutes);
app.use('/api/admin/encryption', encryptionSectionsRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api/posts', postsRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/follows', followsRoutes);
app.use('/api/hashtags', hashtagsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/messages', messagesRoutes);

// ─── Routes إضافية ──────────────────────────────────────────────
app.use('/api/2fa', twofaRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/username', usernameRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/notifications/preferences', notificationPreferencesRoutes);
app.use('/api/communities', communitiesRoutes);
app.use('/api/stats', statsRoutes);

// ─── 404 + معالج الأخطاء ────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, message: 'المسار غير موجود' })
);
app.use((err, req, res, next) => {
  logger.error(`${err.message} - ${req.originalUrl} - ${req.ip}`);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'حدث خطأ بالخادم' : err.message,
  });
});

// ─── تشغيل ────────────────────────────────────────────────────
const httpServer = http.createServer(app);

async function start() {
  try {
    await connectDB();
    await connectRedis();
    attachWebSocketServer(httpServer);

    httpServer.listen(PORT, () => {
      logger.info('========================================');
      logger.info('AR App - الخادم يعمل');
      logger.info(`العنوان: http://localhost:${PORT}`);
      logger.info('WebSocket متاح على المسار /ws');
      logger.info('========================================');
      startCronJobs();
 startQueueWorkers();

      setInterval(() => {
        updateDBMetrics(query);
        setActiveUsers(getOnlineUserIds().length);
      }, 60 * 1000);
    });
  } catch (err) {
    logger.error('فشل تشغيل الخادم:', err);
    process.exit(1);
  }
}

start();
module.exports = app;
