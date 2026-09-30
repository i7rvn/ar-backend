// ═══════════════════════════════════════════════════════════════
// أداة تشخيص مؤقتة — تعرض القيم الحقيقية المخزَّنة بجدول client_keys
//
// السبب: على منصات بلا Shell (Render Free)، ما كاين طريقة مباشرة
// تشوف بيها محتوى القاعدة الفعلي لمقارنته باللي حاطط بـ config.js.
// هذا الـ endpoint يحل المشكلة بلا حاجة أدوات خارجية (pgAdmin/psql).
//
// ⚠️ احذف هذا الملف (وسطر الـ require/app.use تاعو بـ index.js) بعد
// ما تحل المشكلة — بلا داعي يبقى بالكود بعد التشخيص، حتى لو الخطر
// منخفض (client keys أصلاً ماشي أسرار حقيقية، راجع تعليق config.js).
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const { query } = require('../config/database');

const router = express.Router();

router.get('/client-keys', async (req, res) => {
  // حارس بسيط: يطلب نفس ADMIN_PASSWORD كـ query param، باش ما يقدرش
  // أي زائر عشوائي يشوف هذا الرد بلا أي معرفة مسبقة بمشروعك
  if (req.query.secret !== process.env.ADMIN_PASSWORD) {
    return res.status(404).json({ success: false, message: 'غير موجود' });
  }

  const result = await query(
    `SELECT client_name, api_key, is_active, created_at FROM client_keys ORDER BY client_name`
  );

  res.json({
    success: true,
    note: 'قارن هذي القيم حرفياً (نسخ/لصق) مع CLIENT_KEY بملف config.js تاع كل موقع',
    data: result.rows,
  });
});

module.exports = router;
