const { createClient } = require('redis');
const logger = require('./logger');

// نفضّل REDIS_URL (رابط rediss://... كامل من Upstash) إذا كان موجوداً،
// لأنه الطريقة الموصى بها رسمياً من node-redis ويضبط TLS تلقائياً
// من صيغة الرابط نفسها (rediss:// = TLS)، بدل بناء الإعدادات يدوياً
// (host/port/tls منفصلين) وهو أكثر عرضة لتعارضات إعداد تسبب تعليق
// الاتصال (Connection timeout) بدل خطأ واضح.
const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST || 'localhost';
const isLocalHost = ['localhost', 'redis', '127.0.0.1'].includes(redisHost);

const client = redisUrl
  ? createClient({
      url: redisUrl,
      socket: { tls: redisUrl.startsWith('rediss://'), rejectUnauthorized: false },
    })
  : createClient({
      socket: {
        host: redisHost,
        port: parseInt(process.env.REDIS_PORT) || 6379,
        tls: !isLocalHost,
        rejectUnauthorized: false,
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
      },
      password: process.env.REDIS_PASSWORD,
    });

client.on('error', (err) => logger.error('Redis خطأ:', err));
client.on('connect', () => logger.info('تم الاتصال بـ Redis'));

async function connectRedis() {
 await client.connect();
}

// ─── OTP ─────────────────────────────────────────────────────
async function setOTP(email, code) {
 const key = `otp:${email}`;
 await client.setEx(key, 600, code); // 10 دقائق
}

async function getOTP(email) {
 return await client.get(`otp:${email}`);
}

async function deleteOTP(email) {
 await client.del(`otp:${email}`);
}

// ─── عداد محاولات OTP الخاطئة ────────────────────────────────
async function incrementOTPAttempts(email) {
 const key = `otp_attempts:${email}`;
 const count = await client.incr(key);
 if (count === 1) await client.expire(key, 3600); // ساعة واحدة
 return count;
}

async function getOTPAttempts(email) {
 return parseInt(await client.get(`otp_attempts:${email}`)) || 0;
}

// ─── القائمة السوداء للـ JWT ──────────────────────────────────
async function blacklistToken(token, expiresIn) {
 await client.setEx(`blacklist:${token}`, expiresIn, '1');
}

async function isTokenBlacklisted(token) {
 return await client.exists(`blacklist:${token}`) === 1;
}

// ─── Cache عام ───────────────────────────────────────────────
async function setCache(key, value, ttlSeconds = 300) {
 await client.setEx(key, ttlSeconds, JSON.stringify(value));
}

async function getCache(key) {
 const val = await client.get(key);
 return val ? JSON.parse(val) : null;
}

async function deleteCache(key) {
 await client.del(key);
}

// ─── VPN Cache (لتجنب الاستعلام عن نفس IP مرتين) ─────────────
async function setVPNResult(ip, result) {
 await client.setEx(`vpn:${ip}`, 3600, JSON.stringify(result)); // ساعة
}

async function getVPNResult(ip) {
 const val = await client.get(`vpn:${ip}`);
 return val ? JSON.parse(val) : null;
}

module.exports = {
 client,
 connectRedis,
 setOTP, getOTP, deleteOTP,
 incrementOTPAttempts, getOTPAttempts,
 blacklistToken, isTokenBlacklisted,
 setCache, getCache, deleteCache,
 setVPNResult, getVPNResult,
};
