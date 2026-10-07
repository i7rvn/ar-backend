const express = require('express');
const QRCode = require('qrcode');
const { authenticate } = require('../../middleware/auth');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const { validate } = require('../../middleware/validate');
const { query } = require('../../config/database');
const { getCache, setCache, deleteCache } = require('../../config/redis');

const router = express.Router();

// Public preflight only; registration still performs the authoritative uniqueness check.
router.get('/username-availability', async (req, res) => {
  const username = String(req.query.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,50}$/.test(username)) {
    return res.status(400).json({ success: false, message: 'اسم المستخدم يجب أن يكون من 3 إلى 50 حرفاً أو رقماً أو شرطة سفلية', code: 'INVALID_USERNAME' });
  }

  try {
    const result = await query(
      `SELECT
         EXISTS (SELECT 1 FROM users WHERE LOWER(username) = $1) AS taken,
         EXISTS (SELECT 1 FROM reserved_usernames WHERE LOWER(username) = $1) AS reserved`,
      [username]
    );
    const available = !result.rows[0].taken && !result.rows[0].reserved;
    res.json({ success: true, data: { available } });
  } catch {
    res.status(500).json({ success: false, message: 'تعذر التحقق من اسم المستخدم الآن', code: 'USERNAME_CHECK_FAILED' });
  }
});

// ─── البحث عن مستخدمين ────────────────────────────────────────
// يجب أن يسبق /:username؛ وإلا سيُفسَّر GET /search كأنه ملف
// شخصي للمستخدم الذي اسمه "search".
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

// ─── اقتراحات متابعة ("من تتابع؟") ─────────────────────────────
// يجب أن يسبق /:username لنفس سبب /search أعلاه.
router.get('/suggestions', authenticate, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 3, 10);
    const cacheKey = `suggestions:${req.user.id}:${limit}`;
    const cached = await getCache(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    // أعلى المستخدمين بعدد المتابعين، بشرط: ماشي أنا، ماشي متابَع
    // من قبل، ماشي محظور مني، وحسابه مو محظور من الإدارة.
    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url,
              u.is_verified, u.followers_count
       FROM users u
       WHERE u.id != $1
         AND u.is_banned = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM follows f
           WHERE f.follower_id = $1 AND f.following_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE b.blocker_id = $1 AND b.blocked_id = u.id
         )
       ORDER BY u.followers_count DESC, u.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );

    await setCache(cacheKey, result.rows, 120); // دقيقتين — قائمة صغيرة، تحدّث بسرعة كافية
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب الاقتراحات' });
  }
});

// ─── QR للملف الشخصي ─────────────────────────────────────────
// عام (رابط البروفايل معلومة عامة أصلاً). نتحقق أن المستخدم موجود فعلاً
// قبل التوليد — يمنع استغلال هذا الـendpoint كمولّد QR مجاني لأي نص.
router.get('/:username/qr', async (req, res) => {
  try {
    const exists = await query(
      `SELECT username FROM users WHERE username = $1 AND is_banned = FALSE`,
      [req.params.username]
    );
    if (!exists.rows.length) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://ar4ar.vercel.app';
    const profileUrl = `${frontendUrl}/profile/${encodeURIComponent(exists.rows[0].username)}`;

    const png = await QRCode.toBuffer(profileUrl, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400', // رابط البروفايل ثابت، كاش يوم كامل
    });
    res.send(png);
  } catch (err) {
    res.status(500).json({ success: false, message: 'فشل توليد الرمز' });
  }
});

// ─── متابَعون مشتركون ("يتابعه X وY ممن تتابعهم") ─────────────────
// الحسابات لي أنا (المشاهد) أتابعها وهي بدورها تتابع صاحب هذا الملف.
// مخصّص للمشاهد المسجَّل فقط (يعتمد على قائمة متابعاته هو).
router.get('/:username/mutual-followers', authenticate, async (req, res) => {
  try {
    const target = await query(`SELECT id FROM users WHERE username = $1`, [req.params.username]);
    if (!target.rows.length) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    const targetId = target.rows[0].id;

    if (targetId === req.user.id) {
      return res.json({ success: true, data: { users: [], total: 0 } }); // ما فيه معنى لملفي أنا
    }

    const result = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url,
              COUNT(*) OVER() AS total
       FROM follows my_follows
       JOIN follows their_followers ON their_followers.follower_id = my_follows.following_id
       JOIN users u ON u.id = my_follows.following_id
       WHERE my_follows.follower_id = $1
         AND their_followers.following_id = $2
         AND u.is_banned = FALSE
       ORDER BY my_follows.created_at DESC
       LIMIT 3`,
      [req.user.id, targetId]
    );

    const total = result.rows.length ? parseInt(result.rows[0].total) : 0;
    const users = result.rows.map(({ total: _t, ...rest }) => rest);
    res.json({ success: true, data: { users, total } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في جلب المتابَعين المشتركين' });
  }
});

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
 const { display_name, bio, location, website, avatar_url, banner_url } = req.body;

 // تحقق أمني حقيقي (ماشي فحص شكل الرابط فقط): avatar_url/banner_url
 // يُقبَلان فقط إذا كانا يطابقان صورة (type='image') موجودة فعلاً
 // بجدول media ومملوكة لهذا المستخدم بالذات — يمنع استعمال رابط
 // فيديو، أو رابط صورة مستخدم آخر، أو رابط خارجي عشوائي كأفاتار
 async function verifyOwnImage(url) {
 if (!url) return true;
 const result = await query(
 `SELECT 1 FROM media WHERE url = $1 AND user_id = $2 AND type = 'image'`,
 [url, req.user.id]
 );
 return result.rows.length > 0;
 }

 if (avatar_url !== undefined && avatar_url !== '' && !(await verifyOwnImage(avatar_url))) {
 return res.status(400).json({ success: false, message: 'رابط الصورة غير صالح — ارفع الصورة أولاً عبر نظام الرفع' });
 }
 if (banner_url !== undefined && banner_url !== '' && !(await verifyOwnImage(banner_url))) {
 return res.status(400).json({ success: false, message: 'رابط البانر غير صالح — ارفع الصورة أولاً عبر نظام الرفع' });
 }

 const result = await query(
 `UPDATE users
 SET display_name = COALESCE($1, display_name),
 bio = COALESCE($2, bio),
 location = COALESCE($3, location),
 website = COALESCE($4, website),
 avatar_url = COALESCE(NULLIF($5, ''), avatar_url),
 banner_url = COALESCE(NULLIF($6, ''), banner_url),
 updated_at = NOW()
 WHERE id = $7
 RETURNING id, username, display_name, bio, location, website, avatar_url, banner_url`,
 [display_name, bio, location, website, avatar_url, banner_url, req.user.id]
 );

 // مسح الـ cache القديم
 await deleteCache(`profile:${req.user.username}`);

 res.json({ success: true, data: result.rows[0], message: 'تم تحديث الملف الشخصي' });
 } catch (err) {
 res.status(500).json({ success: false, message: 'خطأ في التحديث' });
 }
});

module.exports = router;
