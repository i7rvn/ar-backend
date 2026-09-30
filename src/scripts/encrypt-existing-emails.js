// ═══════════════════════════════════════════════════════════════
// AR App — سكريبت تحويل: تشفير كل البريد الإلكتروني الموجود مسبقاً
//
// يُشغَّل مرة واحدة يدوياً، بعد ضبط DECRYPT_CODE_WEB/ANDROID/IOS:
//   node src/scripts/encrypt-existing-emails.js
//
// آمن لإعادة التشغيل (idempotent) — يتخطى أي صف عندو email_enc
// موجود مسبقاً، فما يعيدش تشفير صف تم تشفيره.
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const { query, connectDB } = require('../config/database');
const { encryptField, hashEmailForLookup } = require('../utils/fieldCrypto');

async function run() {
  await connectDB();

  const result = await query(
    `SELECT id, email, data_section FROM users WHERE email_enc IS NULL AND email IS NOT NULL`
  );

  console.log(`عدد الصفوف المطلوب تشفيرها: ${result.rows.length}`);

  let done = 0;
  for (const row of result.rows) {
    const section = row.data_section || 'web';
    const { enc, iv, tag } = encryptField(row.email, section);
    const lookupHash = hashEmailForLookup(row.email);

    await query(
      `UPDATE users SET email_lookup_hash = $1, email_enc = $2, email_iv = $3, email_tag = $4 WHERE id = $5`,
      [lookupHash, enc, iv, tag, row.id]
    );
    done += 1;
    if (done % 100 === 0) console.log(`... ${done}/${result.rows.length}`);
  }

  console.log(`تم تشفير ${done} صف.`);
  console.log(
    'الخطوة التالية (يدوياً، بعد التأكد أن كل شيء يشتغل): ' +
    'UPDATE users SET email = NULL; ثم ALTER TABLE users ALTER COLUMN email DROP NOT NULL;'
  );
  process.exit(0);
}

run().catch((err) => {
  console.error('فشل السكريبت:', err);
  process.exit(1);
});
