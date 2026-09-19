const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

// مصادقة اختيارية: إذا كان توكن صالح يعبّي req.user، وإلا يكمل بدون خطأ
// مفيدة لصفحات عرض عامة (مثلاً بروفايل) تتصرف بشكل مختلف للمستخدم المسجّل
async function optionalAuthenticate(req, res, next) {
 try {
 const authHeader = req.headers.authorization;
 if (!authHeader?.startsWith('Bearer ')) return next();

 const token = authHeader.split(' ')[1];
 const decoded = jwt.verify(token, process.env.JWT_SECRET);

 const result = await query(
 `SELECT id, username, display_name, avatar_url, is_verified FROM users WHERE id = $1`,
 [decoded.userId]
 );
 if (result.rows.length > 0) req.user = result.rows[0];
 } catch {
 // نتجاهل أي خطأ توكن هنا — الهدف اختياري فقط
 }
 next();
}

module.exports = { optionalAuthenticate };
