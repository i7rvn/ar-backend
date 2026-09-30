const express = require('express');
const controller = require('./posts.controller');
const { authenticate } = require('../../middleware/auth');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const { z } = require('zod');
const { validate } = require('../../middleware/validate');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// حد النشر (30 تغريدة / ساعة)
const postLimiter = rateLimit({
 windowMs: 60 * 60 * 1000,
 max: 30,
 message: { success: false, message: 'نشرت كثيراً، انتظر قليلاً' },
});

// ─── مسارات عامة (بدون تسجيل دخول إجباري) ───────────────────────
router.get('/:id', optionalAuthenticate, controller.getPost);
router.get('/:id/replies', controller.getReplies);

// ─── مسارات محمية ─────────────────────────────────────────────
router.post('/', authenticate, postLimiter, controller.createPost);
router.delete('/:id', authenticate, controller.deletePost);
router.post('/:id/like', authenticate, controller.toggleLike);
router.post('/:id/pin', authenticate, controller.pinPost);
router.post('/:id/unpin', authenticate, controller.unpinPost);

module.exports = router;
