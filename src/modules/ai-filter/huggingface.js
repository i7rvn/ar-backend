// ═══════════════════════════════════════════════════════════════
// AR App — Hugging Face (فحص الصور)
// ═══════════════════════════════════════════════════════════════

const axios = require('axios');
const logger = require('../../config/logger');
const { query } = require('../../config/database');

const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;
const NSFW_MODEL = 'Falconsai/nsfw_image_detection';
const HF_BASE_URL = 'https://api-inference.huggingface.co/models';

// ─── فحص صورة ─────────────────────────────────────────────────
async function checkImage(imageBuffer, mediaId, userId) {
 try {
 if (!HF_TOKEN) {
 logger.warn(' HUGGINGFACE_TOKEN غير موجود، تجاوز فحص الصورة');
 return { action: 'approved', scores: {} };
 }

 const response = await axios.post(
 `${HF_BASE_URL}/${NSFW_MODEL}`,
 imageBuffer,
 {
 headers: {
 Authorization: `Bearer ${HF_TOKEN}`,
 'Content-Type': 'application/octet-stream',
 },
 timeout: 15000,
 }
 );

 // النتيجة: [{label: "nsfw", score: 0.95}, {label: "normal", score: 0.05}]
 const results = response.data;
 const nsfwItem = results.find(r => r.label === 'nsfw') || { score: 0 };
 const safeItem = results.find(r => r.label === 'normal') || { score: 1 };

 const nsfwScore = nsfwItem.score;
 let action = 'approved';

 if (nsfwScore >= 0.85) {
 action = 'rejected';
 logger.warn(`صورة مرفوضة (NSFW: ${nsfwScore.toFixed(2)}) للمستخدم ${userId}`);
 } else if (nsfwScore >= 0.50) {
 action = 'review';
 }

 // حفظ نتيجة الفحص
 await query(
 `INSERT INTO content_checks
 (content_type, content_id, user_id, nsfw_score, action, raw_response)
 VALUES ('image', $1, $2, $3, $4, $5)`,
 [mediaId, userId, nsfwScore, action, JSON.stringify(results)]
 );

 return { action, scores: { nsfw: nsfwScore, safe: safeItem.score } };

 } catch (err) {
 logger.warn(`فشل فحص الصورة: ${err.message}`);
 // في حالة الخطأ: اسمح بالمرور
 return { action: 'approved', scores: {} };
 }
}

module.exports = { checkImage };
