const { query } = require('../config/database');

// تحقق CLIENT_KEY — الحجاب الأمني الأول قبل أي معالجة أخرى
// كل عميل (Web/Dashboard/Android/iOS) عندو مفتاح ثابت بالهيدر X-Client-Key
// مفتاح Dashboard مقبول فقط على مسارات /api/admin/*، وباقي المفاتيح
// مقبولة على كل المسارات الأخرى، حسب المطلوب بمواصفات المشروع.
async function requireClientKey(req, res, next) {
  const key = req.headers['x-client-key'];
  if (!key) {
    return res.status(401).json({ success: false, message: 'مفتاح العميل مفقود', code: 'NO_CLIENT_KEY' });
  }

  const result = await query(
    `SELECT client_name FROM client_keys WHERE api_key = $1 AND is_active = TRUE`,
    [key]
  );

  if (result.rows.length === 0) {
    return res.status(403).json({ success: false, message: 'مفتاح عميل غير صالح', code: 'INVALID_CLIENT_KEY' });
  }

  const clientName = result.rows[0].client_name;
  const isAdminPath = req.originalUrl.startsWith('/api/admin');

  if (clientName === 'dashboard' && !isAdminPath) {
    return res.status(403).json({ success: false, message: 'مفتاح العميل غير مسموح لهذا المسار', code: 'CLIENT_PATH_MISMATCH' });
  }
  if (clientName !== 'dashboard' && isAdminPath) {
    return res.status(403).json({ success: false, message: 'مفتاح العميل غير مسموح لهذا المسار', code: 'CLIENT_PATH_MISMATCH' });
  }

  req.clientName = clientName;
  next();
}

module.exports = { requireClientKey };
