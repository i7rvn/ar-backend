// ═══════════════════════════════════════════════════════════════
// تشغيل كل ملفات database/migrations بالترتيب، بلا حاجة لـ psql
//
// الاستخدام (من داخل مجلد src بعد npm install):
//   node scripts/run-migrations.js
//
// يقرأ معطيات الاتصال من .env بنفس مجلد src (أو من متغيرات البيئة
// المضبوطة مباشرة)، ويحتاج فقط: DB_HOST, DB_PORT, DB_NAME, DB_USER,
// DB_PASSWORD (أو DATABASE_URL كاملاً كبديل).
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');

const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_HOST && !['localhost', 'postgres', '127.0.0.1'].includes(process.env.DB_HOST)
        ? { rejectUnauthorized: false }
        : false,
    };

const pool = new Pool(connectionConfig);

function splitStatements(sql) {
  // تقسيم يحترم كتل $$...$$ (أو $tag$...$tag$) المستخدمة بجسم الدوال
  // PL/pgSQL، والتي تحتوي على ; بداخلها بشكل طبيعي كجزء من صيغتها -
  // لا يجوز اعتبار هذي الفواصل المنقوطة الداخلية حدود جمل منفصلة
  const fragments = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    current += char;

    const dollarMatch = !inDollarQuote && sql.slice(i).match(/^\$([a-zA-Z_]*)\$/);
    if (dollarMatch) {
      inDollarQuote = true;
      dollarTag = dollarMatch[0];
      current += dollarMatch[0].slice(1);
      i += dollarMatch[0].length - 1;
      continue;
    }
    if (inDollarQuote && sql.slice(i, i + dollarTag.length) === dollarTag) {
      current += dollarTag.slice(1);
      i += dollarTag.length - 1;
      inDollarQuote = false;
      dollarTag = null;
      continue;
    }

    if (char === ';' && !inDollarQuote) {
      fragments.push(current.slice(0, -1));
      current = '';
    }
  }
  if (current.trim()) fragments.push(current);

  return fragments
    .map((fragment) => {
      const lines = fragment.split('\n');
      while (lines.length > 0 && (lines[0].trim() === '' || lines[0].trim().startsWith('--'))) {
        lines.shift();
      }
      return lines.join('\n').trim();
    })
    .filter((s) => s.length > 0);
}

function isHarmlessError(message) {
  return /already exists|duplicate key|does not exist.*skipping/i.test(message);
}

async function runFile(file, sql, client) {
  try {
    await client.query(sql);
    console.log(`تم بنجاح (دفعة واحدة): ${file}`);
    return;
  } catch (err) {
    // فشل الملف كدفعة واحدة (يُرجع كل شيء بالملف، لأنه معاملة واحدة ضمنية)
    // نعيد المحاولة جملة بجملة، حتى تُطبَّق الجمل السليمة ولو فشلت
    // جملة واحدة فقط (مثل "already exists" عند إعادة تشغيل جزئية)
    console.log(`فشل ${file} كدفعة واحدة (${err.message})، إعادة المحاولة جملة بجملة...`);
  }

  const statements = splitStatements(sql);
  let hadRealError = false;

  for (const statement of statements) {
    try {
      await client.query(statement);
    } catch (err) {
      if (isHarmlessError(err.message)) {
        console.log(`  تجاوز (موجود مسبقاً): ${statement.slice(0, 60)}...`);
      } else {
        hadRealError = true;
        console.log(`  خطأ حقيقي بجملة: ${statement.slice(0, 60)}...`);
        console.log(`  ${err.message}`);
      }
    }
  }

  if (hadRealError) {
    throw new Error(`فشل migration بسبب أخطاء SQL حقيقية: ${file}`);
  }
  console.log(`تم بنجاح (جملة بجملة): ${file}`);
}

async function runMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    console.log('لم أجد مجلد database/migrations بالمسار:', migrationsDir);
    if (require.main === module) process.exit(1);
    throw new Error('migrations directory not found');
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`عدد ملفات الترحيل: ${files.length}`);

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [1095916873, 1]);
    lockAcquired = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS ar_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const appliedResult = await client.query('SELECT filename FROM ar_schema_migrations');
    const appliedFiles = new Set(appliedResult.rows.map((row) => row.filename));

    for (const file of files) {
      if (appliedFiles.has(file)) {
        console.log(`تجاوز الترحيل المطبق مسبقاً: ${file}`);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`تشغيل: ${file} ...`);
      await runFile(file, sql, client);
      await client.query(
        'INSERT INTO ar_schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
        [file],
      );
    }

    console.log('انتهى تشغيل كل ملفات الترحيل.');
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [1095916873, 1]);
      } catch (unlockError) {
        console.error('تعذر تحرير قفل الترحيلات:', unlockError.message);
      }
    }
    client.release();
  }

  if (require.main === module) {
    await pool.end();
  }
}
// وضعين: CLI مباشر (node scripts/run-migrations.js) يقفل العملية عند
// النهاية/الخطأ؛ أو require() من index.js (بوتستراب تلقائي بالإقلاع
// على منصات بلا Shell زي Render Free) يرجّع Promise عادي بلا exit
if (require.main === module) {
  runMigrations().catch(async (err) => {
    console.log('خطأ عام:', err.message);
    await pool.end();
    process.exit(1);
  });
}

module.exports = { runMigrations };
