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

// ─── Routes جديدة لدعم Admin Dashboard الكامل ───────────────────
const dashboardUsersRoutes = require('./modules/admin/dashboardUsers.routes');
const dashboardPostsRoutes = require('./modules/admin/dashboardPosts.routes');
const dashboardCommunitiesRoutes = require('./modules/admin/dashboardCommunities.routes');
const vpnLogsRoutes = require('./modules/admin/vpnLogs.routes');
const inviteCodesRoutes = require('./modules/admin/inviteCodes.routes');
const telegramSettingsRoutes = require('./modules/admin/telegramSettings.routes');

const { query } = require('./config/database');

function assertProductionSecurityConfig() {
  if (process.env.NODE_ENV === 'production' &&
      process.env.SKIP_OTP_VERIFICATION === 'true') {
    throw new Error(
      'SECURITY CONFIGURATION ERROR: SKIP_OTP_VERIFICATION=true is forbidden in production'
    );
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Render (وأغلب منصات الاستضافة السحابية) يمرّر الطلبات عبر reverse
// proxy واحد قبل ما توصل للسيرفر. بلا هذا الإعداد، Express يشوف IP
// الـ proxy الداخلي نفسه بكل طلب (ماشي IP الزائر الحقيقي) — يعني
// express-rate-limit يحسب كل مستخدمي المنصة كأنهم شخص واحد بنفس
// الحد (bucket واحد مشترك)، وهذا يفشّل الحماية من brute-force/spam
// تماماً بلا ما يبان أي خطأ ظاهري. القيمة 1 = نثق بأول proxy فقط
// (خطوة Render نفسها)، ماشي `true` لي يثق بأي عدد قفزات (يفتح باب
// تزوير X-Forwarded-For من العميل نفسه).
app.set('trust proxy', 1);

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

// ─── CORS — نطاقات متعددة مسموحة (موقع المستخدمين + الداشبورد) ──
// كانت مبنية على أصل واحد فقط (FRONTEND_URL)، ما تكفيش دابا بعد
// إضافة الداشبورد كموقع منفصل بنطاق مختلف. الحماية الحقيقية هنا
// مزدوجة: هذا الفحص + X-Client-Key (بمنتصف requireClientKey) اللي
// يربط كل مفتاح بمساره المسموح فقط.
const ALLOWED_ORIGINS = [process.env.FRONTEND_URL, process.env.DASHBOARD_URL].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // بلا Origin (طلبات من أدوات كيما curl/Postman أو نفس السيرفر) — نسمح
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('غير مسموح من هذا النطاق (CORS)'));
  },
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
app.use('/api/admin/users', dashboardUsersRoutes);
app.use('/api/admin/posts', dashboardPostsRoutes);
app.use('/api/admin/communities', dashboardCommunitiesRoutes);
app.use('/api/admin/vpn-logs', vpnLogsRoutes);
app.use('/api/admin/invite-codes', inviteCodesRoutes);
app.use('/api/admin/telegram-settings', telegramSettingsRoutes);
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
    assertProductionSecurityConfig();
    await connectDB();
    await connectRedis();

    // بوتستراب تلقائي اختياري: يشغّل migrations + seed-owner عند
    // إقلاع السيرفر نفسه — مصمَّم خصيصاً لمنصات بلا Shell ولا
    // pre-deploy command (Render Free Tier مثلاً). كلاهما idempotent
    // (يتحقق "موجود مسبقاً" قبل أي INSERT)، فتفعيله بشكل دائم بلا
    // خطر حتى بعد أول نشر — بس يضيف ثوانٍ قليلة لكل إقلاع.
    // فعّله بمتغير بيئة AUTO_MIGRATE_AND_SEED=true بـ Render فقط؛
    // بـ Docker Compose المحلي migrations تتطبّق أصلاً عبر
    // docker-entrypoint-initdb.d، فما تحتاجوش هنا (اختياري كيفما تحب).
    if (process.env.AUTO_MIGRATE_AND_SEED === 'true') {
      logger.info('AUTO_MIGRATE_AND_SEED مفعّل — تشغيل migrations + seed-owner...');
      try {
        const { runMigrations } = require('./scripts/run-migrations');
        await runMigrations();
        const { main: seedMain } = require('./scripts/seed-owner');
        await seedMain();
        logger.info('انتهى البوتستراب التلقائي بنجاح.');
      } catch (bootstrapErr) {
        logger.error('فشل البوتستراب التلقائي (migrations/seed):', bootstrapErr.message);
        // ما نوقفوش السيرفر بالكامل هنا — لو migrations اتطبّقت مسبقاً
        // بطريقة يدوية، فشل جزء منها لاحقاً (مثلاً كود تعديل خفيف)
        // ماشي سبب كافي يمنع السيرفر من الإقلاع أصلاً
      }
    }

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
