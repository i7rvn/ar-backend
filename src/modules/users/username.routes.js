// ═══════════════════════════════════════════════════════════════
// AR App — فحص توفر اسم المستخدم لحظياً + تغيير اسم المستخدم
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { query } = require('../../config/database');
const { getSetting } = require('../../config/settings');
const { logActivity } = require('./activityHistory.service');

const router = express.Router();

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

// ─── فحص لحظي: متاح / مستخدم / محجوز / صيغة غير صالحة ────────────
router.get('/check/:username', async (req, res) => {
  const username = req.params.username.toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return res.json({ success: true, status: 'invalid', message: 'صيغة اسم المستخدم غير صالحة' });
  }

  const reserved = await query(`SELECT username FROM reserved_usernames WHERE username = $1`, [username]);
  if (reserved.rows.length > 0) {
    return res.json({ success: true, status: 'reserved', message: 'هذا الاسم محجوز' });
  }

  const releasedHistory = await query(
    `SELECT released_at FROM username_history WHERE old_username = $1 ORDER BY released_at DESC LIMIT 1`,
    [username]
  );
  if (releasedHistory.rows.length > 0 && new Date(releasedHistory.rows[0].released_at) > new Date()) {
    return res.json({ success: true, status: 'reserved', message: 'هذا الاسم محجوز مؤقتاً' });
  }

  const existing = await query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (existing.rows.length > 0) {
    return res.json({ success: true, status: 'taken', message: 'هذا الاسم مستخدم بالفعل' });
  }

  res.json({ success: true, status: 'available', message: 'هذا الاسم متاح' });
});

// ─── تغيير اسم المستخدم (مرة كل فترة قابلة للتعديل من الإعدادات) ──
router.put('/', authenticate, async (req, res) => {
  const { newUsername } = req.body;
  const username = (newUsername || '').toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return res.status(400).json({ success: false, message: 'صيغة اسم المستخدم غير صالحة' });
  }

  const current = await query(
    `SELECT username, username_changed_at FROM users WHERE id = $1`,
    [req.user.id]
  );
  const currentUsername = current.rows[0].username;
  const lastChangedAt = current.rows[0].username_changed_at;

  if (username === currentUsername) {
    return res.status(400).json({ success: false, message: 'هذا هو اسمك الحالي بالفعل' });
  }

  const cooldownDays = parseInt(await getSetting('username_change_days', 30));
  if (lastChangedAt) {
    const daysSince = (Date.now() - new Date(lastChangedAt).getTime()) / (1000 * 3600 * 24);
    if (daysSince < cooldownDays) {
      const remaining = Math.ceil(cooldownDays - daysSince);
      return res.status(429).json({
        success: false,
        message: `يمكنك تغيير اسم المستخدم بعد ${remaining} يوم`,
        code: 'USERNAME_CHANGE_COOLDOWN',
      });
    }
  }

  const reserved = await query(`SELECT username FROM reserved_usernames WHERE username = $1`, [username]);
  if (reserved.rows.length > 0) {
    return res.status(400).json({ success: false, message: 'هذا الاسم محجوز' });
  }

  const takenBySomeoneElse = await query(
    `SELECT id FROM users WHERE username = $1 AND id != $2`,
    [username, req.user.id]
  );
  if (takenBySomeoneElse.rows.length > 0) {
    return res.status(409).json({ success: false, message: 'هذا الاسم مستخدم بالفعل' });
  }

  const reservationDays = parseInt(await getSetting('username_change_days', 30));

  await query(
    `UPDATE users SET username = $1, username_changed_at = NOW() WHERE id = $2`,
    [username, req.user.id]
  );

  await query(
    `INSERT INTO username_history (user_id, old_username, released_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 day' * $3)`,
    [req.user.id, currentUsername, reservationDays]
  );

  await logActivity(req.user.id, 'username_changed', req, { from: currentUsername, to: username });

  res.json({ success: true, message: 'تم تغيير اسم المستخدم' });
});

module.exports = router;
