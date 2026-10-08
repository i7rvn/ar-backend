const { Pool } = require('pg');
const logger = require('./logger');

const pool = new Pool(
 process.env.DATABASE_URL
 ? {
   connectionString: process.env.DATABASE_URL,
   ssl: { rejectUnauthorized: false },
   max: 20,
   idleTimeoutMillis: 30000,
   connectionTimeoutMillis: 5000,
 }
 : {
   host: process.env.DB_HOST,
   port: parseInt(process.env.DB_PORT) || 5432,
   database: process.env.DB_NAME,
   user: process.env.DB_USER,
   password: process.env.DB_PASSWORD,
   max: 20,
   idleTimeoutMillis: 30000,
   connectionTimeoutMillis: 5000,
   ssl: process.env.DB_HOST && !['localhost', 'postgres', '127.0.0.1'].includes(process.env.DB_HOST)
   ? { rejectUnauthorized: false }
   : false,
 }
);

pool.on('error', (err) => {
 logger.error('خطأ في قاعدة البيانات:', err);
});

async function connectDB() {
 const client = await pool.connect();
 logger.info('تم الاتصال بـ PostgreSQL');
 client.release();
}

// دالة مساعدة لتنفيذ الاستعلامات
async function query(text, params) {
 const start = Date.now();
 try {
 const result = await pool.query(text, params);
 const duration = Date.now() - start;
 if (duration > 1000) {
 logger.warn(`استعلام بطيء (${duration}ms): ${text}`);
 }
 return result;
 } catch (err) {
 logger.error(`خطأ في الاستعلام: ${text}`, err);
 throw err;
 }
}

// معاملة (Transaction) للعمليات المتعددة
async function withTransaction(callback) {
 const client = await pool.connect();
 try {
 await client.query('BEGIN');
 const result = await callback(client);
 await client.query('COMMIT');
 return result;
 } catch (err) {
 await client.query('ROLLBACK');
 throw err;
 } finally {
 client.release();
 }
}

module.exports = { pool, connectDB, query, withTransaction };
