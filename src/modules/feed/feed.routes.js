const express = require('express');
const feedService = require('./feed.service');
const { authenticate } = require('../../middleware/auth');
const { respond, asyncHandler } = require('../../utils/helpers');

const router = express.Router();

// فيد "لأجلك" (محمي)
router.get('/for-you', authenticate, asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 20;
 const posts = await feedService.getForYouFeed(req.user.id, page, limit);
 respond.ok(res, { posts, page, limit });
}));

// فيد المتابَعين (محمي)
router.get('/following', authenticate, asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 20;
 const posts = await feedService.getFollowingFeed(req.user.id, page, limit);
 respond.ok(res, { posts, page, limit });
}));

// فيد الرائج (عام)
router.get('/trending', asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 20;
 const posts = await feedService.getTrendingFeed(page, limit);
 respond.ok(res, { posts, page, limit });
}));

// منشورات مستخدم معين
router.get('/user/:userId', asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 20;
 const type = ['posts', 'replies', 'likes'].includes(req.query.type) ? req.query.type : 'posts';
 const posts = await feedService.getUserPosts(
 req.params.userId, req.user?.id, page, limit, type
 );
 respond.ok(res, { posts, page, limit });
}));

module.exports = router;
