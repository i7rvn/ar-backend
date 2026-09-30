// ═══════════════════════════════════════════════════════════════
// AR App — Content Filter Middleware
// يشتغل تلقائياً على كل منشور قبل النشر
// ═══════════════════════════════════════════════════════════════

const { checkContent } = require('../modules/ai-filter/perspective');
const { calculateSpamScore } = require('../modules/ai-filter/spam');
const logger = require('../config/logger');

async function contentFilter(req, res, next) {
 try {
 const { content } = req.body;
 const userId = req.user?.id;

 if (!content || !userId) return next();

 // ─── 1. فحص السبام أولاً (أسرع) ──────────────────────────
 const spamResult = await calculateSpamScore(userId, content);

 if (spamResult.action === 'banned') {
 return res.status(403).json({
 success: false,
 message: 'تم إيقاف حسابك تلقائياً بسبب النشاط المشبوه',
 code: 'AUTO_BANNED',
 });
 }

 if (spamResult.action === 'review') {
 // نضيف علامة للمنشور أنه تحت المراجعة
 req.body._spamReview = true;
 req.body._spamScore = spamResult.score;
 }

 // ─── 2. فحص المحتوى بـ Perspective API ────────────────────
 const contentResult = await checkContent(
 content,
 null, // contentId — سيُضاف بعد الحفظ
 'post',
 userId
 );

 if (contentResult.action === 'rejected') {
 return res.status(400).json({
 success: false,
 message: 'المحتوى يخالف سياسة المنصة ولا يمكن نشره',
 code: 'CONTENT_REJECTED',
 });
 }

 if (contentResult.action === 'review') {
 req.body._contentReview = true;
 req.body._toxicityScore = contentResult.scores.toxicity || 0;
 }

 next();
 } catch (err) {
 logger.error('خطأ في content filter:', err);
 // لا نوقف النشر بسبب خطأ في الفلتر
 next();
 }
}

// ─── Middleware خفيف للتعليقات ─────────────────────────────────
async function lightContentFilter(req, res, next) {
 try {
 const { content } = req.body;
 const userId = req.user?.id;
 if (!content || !userId) return next();

 const result = await checkContent(content, null, 'comment', userId);
 if (result.action === 'rejected') {
 return res.status(400).json({
 success: false,
 message: 'التعليق يخالف سياسة المنصة',
 code: 'COMMENT_REJECTED',
 });
 }
 next();
 } catch (err) {
 next();
 }
}

module.exports = { contentFilter, lightContentFilter };
