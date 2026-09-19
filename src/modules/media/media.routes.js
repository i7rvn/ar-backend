const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { uploadMiddleware, handleUpload } = require('./media.service');
const { respond, asyncHandler } = require('../../utils/helpers');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// حد الرفع (20 ملف / ساعة)
const uploadLimiter = rateLimit({
 windowMs: 60 * 60 * 1000,
 max: 20,
 message: { success: false, message: 'رفعت ملفات كثيرة، انتظر ساعة' },
});

// ─── رفع وسائط ────────────────────────────────────────────────
router.post('/upload', authenticate, uploadLimiter, (req, res, next) => {
 uploadMiddleware(req, res, async (err) => {
 if (err) {
 return respond.error(res, err.message, 400);
 }

 if (!req.files || req.files.length === 0) {
 return respond.error(res, 'لم يتم اختيار أي ملف', 400);
 }

 try {
 const uploadedFiles = await Promise.all(
 req.files.map(file => handleUpload(file, req.user.id))
 );

 respond.created(res, {
 files: uploadedFiles.map(f => ({
 id: f.id,
 url: f.url,
 type: f.type,
 })),
 }, 'تم رفع الملفات بنجاح');
 } catch (uploadErr) {
 respond.error(res, 'فشل رفع الملف: ' + uploadErr.message, 500);
 }
 });
});

module.exports = router;
