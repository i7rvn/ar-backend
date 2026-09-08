// ═══════════════════════════════════════════════════════════════
// Seed أول Owner + Client Keys — يُشغَّل مرة واحدة فقط بعد الـ migrations
//
// الاستخدام (من داخل مجلد src أو مع تحميل .env بشكل صحيح):
// node ../scripts/seed-owner.js
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const argon2 = require('argon2');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_HOST && !process.env.DB_HOST.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

async function seedOwner() {
 const email = process.env.ADMIN_EMAIL;
 const username = process.env.ADMIN_USERNAME || 'admin';
 const password = process.env.ADMIN_PASSWORD;

 if (!email || !password) {
 console.log(' ADMIN_EMAIL أو ADMIN_PASSWORD مش موجودين بـ .env — تخطي seed الـ Owner');
 return;
 }

 const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
 let userId;

 if (existingUser.rows.length > 0) {
 userId = existingUser.rows[0].id;
 console.log(`المستخدم ${email} موجود مسبقاً`);
 } else {
 const hash = await argon2.hash(password, { type: argon2.argon2id });
 const inserted = await pool.query(
 `INSERT INTO users (email, username, password_hash, display_name, is_verified, is_admin)
 VALUES ($1, $2, $3, $4, TRUE, TRUE) RETURNING id`,
 [email, username, hash, 'Owner']
 );
 userId = inserted.rows[0].id;
 console.log(`تم إنشاء حساب المستخدم: ${email}`);
 }

 const ownerRole = await pool.query(`SELECT id FROM roles WHERE name = 'owner'`);
 if (ownerRole.rows.length === 0) {
 console.log('دور "owner"غير موجود — تأكد من تشغيل migration 006 أولاً');
 return;
 }

 const existingAdmin = await pool.query('SELECT id FROM admins WHERE user_id = $1', [userId]);
 if (existingAdmin.rows.length > 0) {
 console.log('ℹ حساب الأدمن موجود مسبقاً لهذا المستخدم');
 } else {
 await pool.query(
 `INSERT INTO admins (user_id, role_id, is_owner, totp_required)
 VALUES ($1, $2, TRUE, FALSE)`,
 [userId, ownerRole.rows[0].id]
 );
 console.log('تم إنشاء أول Owner — يمكنك الآن تفعيل 2FA من لوحة الإدارة');
 }
}

async function seedClientKeys() {
 const clients = [
 { name: 'web', key: process.env.CLIENT_KEY_WEB },
 { name: 'dashboard', key: process.env.CLIENT_KEY_DASHBOARD },
 { name: 'android', key: process.env.CLIENT_KEY_ANDROID },
 { name: 'ios', key: process.env.CLIENT_KEY_IOS },
 ];

 for (const c of clients) {
 const hasExplicitKey = c.key && !c.key.startsWith('CHANGE_THIS');

 if (hasExplicitKey) {
 // متغير البيئة هو المرجع الوحيد دائماً — أي تعديل لاحق لـ
 // CLIENT_KEY_* بـ Render يتزامن تلقائياً بقاعدة البيانات بأول
 // إقلاع جاي. قبل هذا التصحيح كان DO NOTHING يتجاهل أي تعديل
 // بعد أول seed، فيبقى المفتاح القديم عالقاً بالقاعدة للأبد
 // بينما الواجهة الأمامية تستعمل القيمة "الجديدة" — يعطي بالضبط
 // خطأ "مفتاح عميل غير صالح" رغم إنك حاطط المفتاح "الصحيح".
 await pool.query(
 `INSERT INTO client_keys (client_name, api_key) VALUES ($1, $2)
 ON CONFLICT (client_name) DO UPDATE SET api_key = EXCLUDED.api_key`,
 [c.name, c.key]
 );
 console.log(`client key لـ "${c.name}" مُزامَن مع متغير البيئة الحالي`);
 } else {
 // بلا قيمة صريحة بالبيئة: نولّد وحدة عشوائية أول مرة فقط ونخليها
 // ثابتة (بلا هذا الشرط، كل إقلاع بلا env var كان يبدّل المفتاح
 // عشوائياً في كل مرة، ويكسر أي عميل مضبوط بمفتاح سابق)
 const existing = await pool.query(
 `SELECT id FROM client_keys WHERE client_name = $1`,
 [c.name]
 );
 if (existing.rows.length === 0) {
 const generated = crypto.randomBytes(32).toString('hex');
 await pool.query(
 `INSERT INTO client_keys (client_name, api_key) VALUES ($1, $2)`,
 [c.name, generated]
 );
 console.log(`⚠ تم توليد مفتاح عشوائي جديد لـ "${c.name}" (بلا CLIENT_KEY_* بالبيئة): ${generated}`);
 } else {
 console.log(`client key لـ "${c.name}" موجود مسبقاً بالقاعدة، بلا env var صريح — بقي كيفما هو`);
 }
 }
 }
}

async function main() {
 try {
 await seedOwner();
 await seedClientKeys();
 } catch (err) {
 console.error('خطأ بالـ seed:', err.message);
 if (require.main === module) throw err;
 } finally {
 // نفس منطق run-migrations.js: نقفل الـ pool فقط لو تشغيل CLI مباشر
 if (require.main === module) {
 await pool.end();
 }
 }
}

if (require.main === module) {
 main().catch(() => process.exit(1));
}

module.exports = { main, seedOwner, seedClientKeys };
