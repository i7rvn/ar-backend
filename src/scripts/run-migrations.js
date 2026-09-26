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

async function runFile(file, sql) {
  try {
    await pool.query(sql);
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
      await pool.query(statement);
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

  console.log(hadRealError ? `انتهى ${file} مع أخطاء حقيقية (راجع أعلاه)` : `تم بنجاح (جملة بجملة): ${file}`);
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

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`تشغيل: ${file} ...`);
    await runFile(file, sql);
  }

  console.log('انتهى تشغيل كل ملفات الترحيل.');
  // pool.end() يصير فقط لما هذا الملف يتشغّل من CLI مباشرة (node
  // run-migrations.js) — لو استُدعي كموديول من index.js (Render free
  // tier بلا Shell/pre-deploy command)، ما نقفلوش الـ pool، والسيرفر
  // هو اللي يكمّل يستعمل اتصاله الخاص بيه عادي
  if (require.main === module) {
    await pool.end();
  }
}

// وضعين: CLI مباشر (node scripts/run-migrations.js) يقفل العملية عند
// النهاية/الخطأ؛ أو require() من index.js (بوتستراب تلقائي بالإقلاع
// على منصات بلا Shell زي Render Free) يرجّع Promise عادي بلا exit
if (require.main === module) {
  runMigrations().catch((err) => {
    console.log('خطأ عام:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigrations };
