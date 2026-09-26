// ═══════════════════════════════════════════════════════════════
// AR App — الحظر بين المستخدمين + الكتم + التقييد
// (منفصلة عن الحظر الإداري الذي يديره الأدمن عبر is_banned)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { query } = require('../../config/database');

const router = express.Router();
router.use(authenticate);

async function findUserIdByUsername(username) {
  const result = await query(`SELECT id FROM users WHERE username = $1`, [username]);
  return result.rows[0]?.id || null;
}

// ─── حظر مستخدم ─────────────────────────────────────────────────
router.post('/block/:username', async (req, res) => {
  const targetId = await findUserIdByUsername(req.params.username);
  if (!targetId) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
  if (targetId === req.user.id) {
    return res.status(400).json({ success: false, message: 'لا يمكن حظر النفس' });
  }

  await query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.user.id, targetId]
  );
  // الحظر يزيل المتابعة بالاتجاهين تلقائياً
  await query(
    `DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)`,
    [req.user.id, targetId]
  );

  res.json({ success: true, message: 'تم حظر المستخدم' });
});

router.delete('/block/:username', async (req, res) => {
  const targetId = await findUserIdByUsername(req.params.username);
  if (!targetId) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
  await query(
    `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [req.user.id, targetId]
  );
  res.json({ success: true, message: 'تم إلغاء الحظر' });
});

router.get('/blocked', async (req, res) => {
  const result = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, b.created_at AS blocked_at
     FROM user_blocks b JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  res.json({ success: true, blocked: result.rows });
});

// ─── الكتم (الطرف الآخر لا يُخطَر بذلك) ──────────────────────────
router.post('/mute/:username', async (req, res) => {
  const targetId = await findUserIdByUsername(req.params.username);
  if (!targetId) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
  await query(
    `INSERT INTO user_mutes (muter_id, muted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.user.id, targetId]
  );
  res.json({ success: true, message: 'تم كتم المستخدم' });
});

router.delete('/mute/:username', async (req, res) => {
  const targetId = await findUserIdByUsername(req.params.username);
  if (!targetId) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
  await query(`DELETE FROM user_mutes WHERE muter_id = $1 AND muted_id = $2`, [req.user.id, targetId]);
  res.json({ success: true, message: 'تم إلغاء الكتم' });
});

// ─── التقييد ─────────────────────────────────────────────────────
router.post('/restrict/:username', async (req, res) => {
  const targetId = await findUserIdByUsername(req.params.username);
  if (!targetId) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
  await query(
    `INSERT INTO user_restricts (restricter_id, restricted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.user.id, targetId]
  );
  res.json({ success: true, message: 'تم تقييد المستخدم' });
});

router.delete('/restrict/:username', async (req, res) => {
  const targetId = await findUserIdByUsername(req.params.username);
  if (!targetId) {
    return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
  }
  await query(
    `DELETE FROM user_restricts WHERE restricter_id = $1 AND restricted_id = $2`,
    [req.user.id, targetId]
  );
  res.json({ success: true, message: 'تم إلغاء التقييد' });
});

module.exports = router;
