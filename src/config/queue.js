// ═══════════════════════════════════════════════════════════════
// AR App — نظام Queue خفيف للمهام الثقيلة
//
// ملاحظة تصميمية: تم تجنّب مكتبة BullMQ لأنها تتطلب ioredis وتتعارض
// مع مكتبة redis v4 المستخدمة أصلاً بكل المشروع (تعارض peer dependency
// حقيقي، جرّبناه وفشل التثبيت). هذا التطبيق مبني فوق نفس عميل Redis
// الموجود، بقائمة (List) للمهام الجاهزة للتنفيذ الفوري، ومجموعة مرتّبة
// (Sorted Set) للمهام المؤجَّلة أو التي تنتظر إعادة محاولة بفاصل زمني
// تصاعدي (Exponential Backoff).
// ═══════════════════════════════════════════════════════════════

const { client: redisClient } = require('./redis');
const logger = require('./logger');

const DELAYED_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_SECONDS = 30; // 30 ثانية، دقيقة، 2 دقائق، 4 دقائق...

function queueKey(name) {
  return `queue:${name}`;
}
function delayedKey(name) {
  return `queue:delayed:${name}`;
}
function failedKey(name) {
  return `queue:failed:${name}`;
}

// ─── إضافة مهمة للتنفيذ الفوري ──────────────────────────────────
async function enqueue(queueName, payload) {
  const job = { payload, attempts: 0, enqueuedAt: Date.now() };
  await redisClient.lPush(queueKey(queueName), JSON.stringify(job));
}

// ─── إضافة مهمة مؤجَّلة (تُنفَّذ بعد delaySeconds) ───────────────
async function enqueueDelayed(queueName, payload, delaySeconds, attempts = 0) {
  const job = { payload, attempts, enqueuedAt: Date.now() };
  const runAt = Date.now() + delaySeconds * 1000;
  await redisClient.zAdd(delayedKey(queueName), [{ score: runAt, value: JSON.stringify(job) }]);
}

// ─── نقل المهام المؤجَّلة التي حان وقتها إلى قائمة التنفيذ الفوري ─
async function promoteDueDelayedJobs(queueName) {
  const now = Date.now();
  const due = await redisClient.zRangeByScore(delayedKey(queueName), 0, now);
  for (const raw of due) {
    const removed = await redisClient.zRem(delayedKey(queueName), raw);
    if (removed) {
      await redisClient.lPush(queueKey(queueName), raw);
    }
  }
}

// ─── بدء مُشغِّل (Worker) لطابور معيّن ────────────────────────────
// handler: async (payload) => يرمي خطأ إذا فشلت المهمة، فتُعاد جدولتها
// تلقائياً بفاصل زمني تصاعدي حتى الحد الأقصى للمحاولات، بعدها تُنقَل
// لطابور failed للمراجعة اليدوية.
function startWorker(queueName, handler, options = {}) {
  const maxRetries = options.maxRetries || DEFAULT_MAX_RETRIES;
  const baseDelaySeconds = options.baseDelaySeconds || DEFAULT_BASE_DELAY_SECONDS;

  let running = true;
  // BRPOP يحجب الاتصال الذي يُرسَل عليه بالكامل، فنستخدم اتصالاً مستقلاً
  // له بدل الاتصال المشترك، بنفس مبدأ duplicate() المستخدم بوحدة websocket
  const blockingClient = redisClient.duplicate();

  async function loop() {
    await blockingClient.connect();

    while (running) {
      let raw;
      try {
        const result = await blockingClient.brPop(queueKey(queueName), 5);
        raw = result?.element;
      } catch (err) {
        logger.error(`خطأ بقراءة طابور ${queueName}:`, err.message);
        await sleep(2000);
        continue;
      }
      if (!raw) continue;

      let job;
      try {
        job = JSON.parse(raw);
      } catch {
        continue;
      }

      try {
        await handler(job.payload);
      } catch (err) {
        job.attempts += 1;
        if (job.attempts >= maxRetries) {
          await redisClient.lPush(failedKey(queueName), JSON.stringify({ ...job, lastError: err.message }));
          logger.error(`مهمة بطابور ${queueName} فشلت نهائياً بعد ${job.attempts} محاولات:`, err.message);
        } else {
          const backoffSeconds = baseDelaySeconds * Math.pow(2, job.attempts - 1);
          await enqueueDelayed(queueName, job.payload, backoffSeconds, job.attempts);
          logger.error(`مهمة بطابور ${queueName} فشلت (محاولة ${job.attempts})، إعادة بعد ${backoffSeconds} ثانية`);
        }
      }
    }
  }

  loop();
  return { stop: () => { running = false; blockingClient.disconnect().catch(() => {}); } };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── مسّاح دوري يفعّل المهام المؤجَّلة عبر كل الطوابير المسجَّلة ───
const registeredQueues = new Set();

function startDelayedJobsPoller() {
  setInterval(() => {
    for (const queueName of registeredQueues) {
      promoteDueDelayedJobs(queueName).catch((err) =>
        logger.error(`خطأ بمسح المهام المؤجَّلة لطابور ${queueName}:`, err.message)
      );
    }
  }, DELAYED_POLL_INTERVAL_MS);
}

function registerQueue(queueName) {
  registeredQueues.add(queueName);
}

module.exports = {
  enqueue,
  enqueueDelayed,
  startWorker,
  startDelayedJobsPoller,
  registerQueue,
};
