const crypto = require('crypto');
const { query } = require('../../config/database');
const { setCache, getCache, deleteCache } = require('../../config/redis');
const { enqueue } = require('../../config/queue');
const { hashPassword, recordPasswordChange, validateNewPassword } = require('./password.service');
const logger = require('../../config/logger');

const RESET_TTL = 1800; // 30 دقيقة

// طلب إعادة تعيين كلمة المرور — قد يطابق البريد أكثر من حساب واحد
// (حتى 3، حسب حد النظام)، فيُرسَل رابط مستقل لكل حساب على حدة، يحدَّد
// فيه اسم المستخدم بوضوح ليعرف المستخدم أي حساب يخص كل رابط
async function requestPasswordReset(email) {
  const userResult = await query(`SELECT id, username FROM users WHERE email = $1`, [email]);
  if (userResult.rows.length === 0) {
    // نرجّع نجاح مزيّف لتفادي كشف وجود البريد من عدمه (enumeration)
    return { success: true };
  }

  for (const { id: userId, username } of userResult.rows) {
    const resetToken = crypto.randomBytes(32).toString('hex');
    await setCache(`pwd_reset:${resetToken}`, { userId }, RESET_TTL);

    const resetLink = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
    await enqueue('generic-emails', {
      type: 'raw-email',
      email,
      subject: 'إعادة تعيين كلمة المرور',
      text: `طلب إعادة تعيين كلمة المرور لحساب @${username}:\n${resetLink}\nصالح لمدة 30 دقيقة.\nإذا لم تطلب هذا، تجاهل هذا البريد.`,
    });

    logger.info(`طلب إعادة تعيين كلمة مرور للمستخدم ${userId} (@${username})`);
  }

  return { success: true };
}

async function resetPasswordWithToken(resetToken, newPassword) {
  const data = await getCache(`pwd_reset:${resetToken}`);
  if (!data) return { success: false, reason: 'رابط منتهي أو غير صالح' };

  const check = await validateNewPassword(data.userId, newPassword);
  if (!check.valid) {
    return { success: false, reason: check.reason };
  }

  const hash = await hashPassword(newPassword);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, data.userId]);
  await recordPasswordChange(data.userId, hash);
  await deleteCache(`pwd_reset:${resetToken}`);

  // إعادة تعيين عبر رابط بريد = إشارة أمان قوية دائماً (احتمال اختراق
  // الحساب هو بالضبط السبب اللي خلّى المستخدم يستعمل هذا المسار) —
  // نبطّل كل الجلسات الحالية بلا استثناء، بلا حاجة لخيار يدوي هنا
  await query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [data.userId]);

  await query(
    `INSERT INTO activity_history (user_id, action, details) VALUES ($1, 'password_reset', '{}')`,
    [data.userId]
  );

  return { success: true, userId: data.userId };
}

module.exports = { requestPasswordReset, resetPasswordWithToken };
