// ═══════════════════════════════════════════════════════════════
// AR App — تفضيلات الإشعارات (toggle حقيقي لكل نوع، متصل بالقاعدة)
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { query } = require('../../config/database');

const router = express.Router();
router.use(authenticate);

const TOGGLABLE_FIELDS = ['likes', 'follows', 'replies', 'reposts', 'messages', 'community_posts'];

router.get('/', async (req, res) => {
  const result = await query(
    `SELECT likes, follows, replies, reposts, messages, community_posts
     FROM notification_preferences WHERE user_id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    // لم يعدّل المستخدم تفضيلاته من قبل - القيم الافتراضية كلها مفعّلة
    return res.json({
      success: true,
      preferences: { likes: true, follows: true, replies: true, reposts: true, messages: true, community_posts: true },
    });
  }

  res.json({ success: true, preferences: result.rows[0] });
});

router.put('/', async (req, res) => {
  const updates = {};
  for (const field of TOGGLABLE_FIELDS) {
    if (typeof req.body[field] === 'boolean') updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'لم يُرسَل أي تفضيل صالح للتعديل' });
  }

  const columns = Object.keys(updates);
  const values = Object.values(updates);
  const insertPlaceholders = columns.map((_, i) => `$${i + 2}`).join(', ');
  const updateAssignments = columns.map((c) => `${c} = EXCLUDED.${c}`).join(', ');

  await query(
    `INSERT INTO notification_preferences (user_id, ${columns.join(', ')})
     VALUES ($1, ${insertPlaceholders})
     ON CONFLICT (user_id) DO UPDATE SET ${updateAssignments}, updated_at = NOW()`,
    [req.user.id, ...values]
  );

  res.json({ success: true, message: 'تم تحديث تفضيلات الإشعارات' });
});

module.exports = router;
