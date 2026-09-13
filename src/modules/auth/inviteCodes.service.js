const crypto = require('crypto');
const { query } = require('../../config/database');

const DEFAULT_EXPIRY_HOURS = 48;

// ─── توليد كود جديد (من الداشبورد فقط) ───────────────────────────
async function generateInviteCode(adminId, note = null, expiryHours = DEFAULT_EXPIRY_HOURS) {
  const code = crypto.randomBytes(8).toString('hex'); // 16 حرف، سهل النسخ يدوياً
  const expiresAt = new Date(Date.now() + expiryHours * 3600 * 1000);

  const result = await query(
    `INSERT INTO invite_codes (code, created_by, expires_at, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id, code, expires_at, created_at`,
    [code, adminId, expiresAt, note]
  );
  return result.rows[0];
}

// ─── فحص + استهلاك ذري (atomic) ─────────────────────────────────
// UPDATE واحد بشرط used_at IS NULL يمنع استعمال نفس الكود مرتين
// بطلبين متزامنين (race condition) — SELECT ثم UPDATE منفصلين كان
// يسمح لطلبين يقرأو "غير مستعمل" بنفس اللحظة قبل ما أي واحد يسجّل
async function consumeInviteCode(code, userId) {
  const result = await query(
    `UPDATE invite_codes
     SET used_at = NOW(), used_by_user_id = $1
     WHERE code = $2 AND used_at IS NULL AND expires_at > NOW()
     RETURNING id`,
    [userId, code]
  );
  return result.rows.length > 0;
}

// ─── قائمة الأكواد (لعرض الداشبورد) ──────────────────────────────
async function listInviteCodes({ status = 'all', limit = 50, offset = 0 } = {}) {
  let condition = '';
  if (status === 'used') condition = 'WHERE ic.used_at IS NOT NULL';
  else if (status === 'unused') condition = 'WHERE ic.used_at IS NULL AND ic.expires_at > NOW()';
  else if (status === 'expired') condition = 'WHERE ic.used_at IS NULL AND ic.expires_at <= NOW()';

  const result = await query(
    `SELECT ic.id, ic.code, ic.expires_at, ic.used_at, ic.note, ic.created_at,
            a.id AS created_by_admin_id, ua.username AS created_by_username,
            uu.username AS used_by_username
     FROM invite_codes ic
     LEFT JOIN admins a ON a.id = ic.created_by
     LEFT JOIN users ua ON ua.id = a.user_id
     LEFT JOIN users uu ON uu.id = ic.used_by_user_id
     ${condition}
     ORDER BY ic.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

module.exports = { generateInviteCode, consumeInviteCode, listInviteCodes };
