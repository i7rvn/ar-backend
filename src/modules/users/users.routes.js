const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const { validate } = require('../../middleware/validate');
const { query } = require('../../config/database');
const { getCache, setCache, deleteCache } = require('../../config/redis');

const router = express.Router();

// ─── عرض ملف شخصي ─────────────────────────────────────────────
router.get('/:username', optionalAuthenticate, async (req, res) => {
 try {
 const cacheKey = `profile:${req.params.username}`;
 let user = await getCache(cacheKey);

 if (!user) {
 const result = await query(
 `SELECT id, username, display_name, bio, avatar_url, banner_url,
 location, website, is_verified, is_private, reputation_points,
 reputation_level(reputation_points) AS reputation_level,
 posts_count, followers_count, following_count, created_at
 FROM users
 WHERE username = $1 AND is_banned = FALSE`,
 [req.params.username]
 );

 if (result.rows.length === 0) {
 return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
 }

 user = result.rows[0];
 await setCache(cacheKey, user, 300); // 5 دقائق
 }

 // حساب إمكانية رؤية المنشورات لحساب خاص - يُحسَب طرياً بلا كاش
 // لأنه يعتمد على هوية الزائر نفسه، بعكس بيانات الملف الشخصي العامة
 let canViewPosts = true;
 let isFollowing = false;
 if (user.is_private && req.user && req.user.id !== user.id) {
 const follow = await query(
 `SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2`,
 [req.user.id, user.id]
 );
 isFollowing = follow.rows.length > 0;
 canViewPosts = isFollowing;
 } else if (user.is_private && !req.user) {
 canViewPosts = false;
 }

 if (req.user && req.user.id !== user.id) {
 query(`INSERT INTO profile_views (profile_user_id, viewer_id) VALUES ($1, $2)`, [user.id, req.user.id]).catch(() => {});
 }

 res.json({ success: true, data: { ...user, isFollowing, canViewPosts } });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ في السرفر' });
 }
});

// ─── تعديل الملف الشخصي ───────────────────────────────────────
router.put('/profile', authenticate, validate('updateProfile'), async (req, res) => {
 try {
 const { display_name, bio, location, website } = req.body;
 const result = await query(
 `UPDATE users
 SET display_name = COALESCE($1, display_name),
 bio = COALESCE($2, bio),
 location = COALESCE($3, location),
 website = COALESCE($4, website),
 updated_at = NOW()
 WHERE id = $5
 RETURNING id, username, display_name, bio, location, website, avatar_url`,
 [display_name, bio, location, website, req.user.id]
 );

 // مسح الـ cache القديم
 await deleteCache(`profile:${req.user.username}`);

 res.json({ success: true, data: result.rows[0], message: 'تم تحديث الملف الشخصي' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ في التحديث' });
 }
});

// ─── البحث عن مستخدمين ────────────────────────────────────────
router.get('/search', async (req, res) => {
 try {
 const { q } = req.query;
 if (!q || q.length < 2) {
 return res.status(400).json({ success: false, message: 'الكلمة قصيرة جداً' });
 }

 const result = await query(
 `SELECT id, username, display_name, avatar_url, is_verified
 FROM users
 WHERE (username ILIKE $1 OR display_name ILIKE $1)
 AND is_banned = FALSE
 LIMIT 20`,
 [`%${q}%`]
 );

 res.json({ success: true, data: result.rows });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ في البحث' });
 }
});

module.exports = router;
