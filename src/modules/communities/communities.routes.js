// ═══════════════════════════════════════════════════════════════
// AR App — المجتمعات
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const { query } = require('../../config/database');

const router = express.Router();

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0600-\u06FF-]/g, '');
}

// ─── قائمة المجتمعات (مجتمعاتي أولاً، ثم مقترحة) ────────────────
router.get('/', authenticate, async (req, res) => {
  const myCommunities = await query(
    `SELECT c.*, cm.role
     FROM communities c JOIN community_members cm ON cm.community_id = c.id
     WHERE cm.user_id = $1 ORDER BY cm.joined_at DESC`,
    [req.user.id]
  );

  const suggested = await query(
    `SELECT c.* FROM communities c
     WHERE c.id NOT IN (SELECT community_id FROM community_members WHERE user_id = $1)
     ORDER BY c.members_count DESC LIMIT 10`,
    [req.user.id]
  );

  res.json({ success: true, myCommunities: myCommunities.rows, suggested: suggested.rows });
});

// ─── إنشاء مجتمع ──────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { name, description } = req.body;
  if (!name || name.trim().length < 3) {
    return res.status(400).json({ success: false, message: 'اسم المجتمع قصير جداً' });
  }

  const slug = slugify(name);
  const existing = await query(`SELECT id FROM communities WHERE slug = $1`, [slug]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ success: false, message: 'يوجد مجتمع بهذا الاسم بالفعل' });
  }

  const inserted = await query(
    `INSERT INTO communities (name, slug, description, created_by, members_count)
     VALUES ($1, $2, $3, $4, 1) RETURNING *`,
    [name.trim(), slug, description || null, req.user.id]
  );
  const community = inserted.rows[0];

  await query(
    `INSERT INTO community_members (community_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [community.id, req.user.id]
  );

  res.status(201).json({ success: true, community });
});

// ─── صفحة مجتمع واحد ──────────────────────────────────────────
router.get('/:slug', optionalAuthenticate, async (req, res) => {
  const result = await query(`SELECT * FROM communities WHERE slug = $1`, [req.params.slug]);
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'المجتمع غير موجود' });
  }
  const community = result.rows[0];

  let isMember = false;
  let role = null;
  if (req.user) {
    const membership = await query(
      `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [community.id, req.user.id]
    );
    if (membership.rows.length > 0) { isMember = true; role = membership.rows[0].role; }
  }

  res.json({ success: true, community, isMember, role });
});

// ─── الانضمام لمجتمع ──────────────────────────────────────────
router.post('/:slug/join', authenticate, async (req, res) => {
  const communityResult = await query(`SELECT id FROM communities WHERE slug = $1`, [req.params.slug]);
  if (communityResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'المجتمع غير موجود' });
  }
  const communityId = communityResult.rows[0].id;

  const inserted = await query(
    `INSERT INTO community_members (community_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING community_id`,
    [communityId, req.user.id]
  );
  if (inserted.rows.length > 0) {
    await query(`UPDATE communities SET members_count = members_count + 1 WHERE id = $1`, [communityId]);
  }

  res.json({ success: true, message: 'تم الانضمام للمجتمع' });
});

// ─── مغادرة مجتمع ─────────────────────────────────────────────
router.post('/:slug/leave', authenticate, async (req, res) => {
  const communityResult = await query(`SELECT id FROM communities WHERE slug = $1`, [req.params.slug]);
  if (communityResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'المجتمع غير موجود' });
  }
  const communityId = communityResult.rows[0].id;

  const membership = await query(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, req.user.id]
  );
  if (membership.rows.length === 0) {
    return res.status(400).json({ success: false, message: 'أنت لست عضواً بهذا المجتمع' });
  }
  if (membership.rows[0].role === 'owner') {
    return res.status(400).json({ success: false, message: 'مالك المجتمع لا يمكنه مغادرته، يمكنه حذفه فقط' });
  }

  await query(`DELETE FROM community_members WHERE community_id = $1 AND user_id = $2`, [communityId, req.user.id]);
  await query(`UPDATE communities SET members_count = GREATEST(members_count - 1, 0) WHERE id = $1`, [communityId]);

  res.json({ success: true, message: 'تم مغادرة المجتمع' });
});

// ─── أعضاء المجتمع ────────────────────────────────────────────
router.get('/:slug/members', async (req, res) => {
  const communityResult = await query(`SELECT id FROM communities WHERE slug = $1`, [req.params.slug]);
  if (communityResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'المجتمع غير موجود' });
  }

  const members = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, cm.role, cm.joined_at
     FROM community_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.community_id = $1 ORDER BY cm.joined_at ASC`,
    [communityResult.rows[0].id]
  );

  res.json({ success: true, members: members.rows });
});

// ─── منشورات المجتمع ──────────────────────────────────────────
router.get('/:slug/posts', optionalAuthenticate, async (req, res) => {
  const communityResult = await query(`SELECT id FROM communities WHERE slug = $1`, [req.params.slug]);
  if (communityResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'المجتمع غير موجود' });
  }

  const limit = parseInt(req.query.limit) || 20;
  const offset = ((parseInt(req.query.page) || 1) - 1) * limit;

  const posts = await query(
    `SELECT p.*, u.username, u.display_name, u.avatar_url, u.is_verified
     FROM posts p JOIN users u ON p.user_id = u.id
     WHERE p.community_id = $1 AND p.is_deleted = FALSE
     ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
    [communityResult.rows[0].id, limit, offset]
  );

  res.json({ success: true, posts: posts.rows });
});

module.exports = router;
