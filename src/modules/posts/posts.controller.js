const postsService = require('./posts.service');
const { respond, asyncHandler } = require('../../utils/helpers');
const { getPollForPost, voteOnPoll } = require('../polls/polls.service');

// ─── إنشاء منشور ──────────────────────────────────────────────
const createPost = asyncHandler(async (req, res) => {
 const { content, mediaUrls, mediaTypes, replyToId, repostOfId, quoteOfId, communityId, isSensitive, sensitiveWarning, poll, poll } = req.body;
 const post = await postsService.createPost({
 userId: req.user.id,
 content, mediaUrls, mediaTypes,
 replyToId, repostOfId, quoteOfId, communityId, isSensitive, sensitiveWarning,
 });
 respond.created(res, post, 'تم نشر تغريدتك');
});

// ─── جلب منشور ────────────────────────────────────────────────
const getPost = asyncHandler(async (req, res) => {
 const post = await postsService.getPost(req.params.id, req.user?.id);
 const pollData = await getPollForPost(req.params.id, req.user?.id);
 if (pollData) post.poll = pollData;
 if (post && req.user && req.user.id !== post.user_id) {
 const { query } = require('../../config/database');
 query(`INSERT INTO post_views (post_id, viewer_id) VALUES ($1, $2)`, [req.params.id, req.user.id]).catch(() => {});
 }
 respond.ok(res, post);
});

// ─── حذف منشور ────────────────────────────────────────────────
const deletePost = asyncHandler(async (req, res) => {
 await postsService.deletePost(req.params.id, req.user.id, req.user.is_admin);
 respond.ok(res, {}, 'تم حذف المنشور');
});

// ─── إعجاب ────────────────────────────────────────────────────
const toggleLike = asyncHandler(async (req, res) => {
 const result = await postsService.toggleLike(req.params.id, req.user.id);
 respond.ok(res, result, result.liked ? 'تم الإعجاب' : 'تم إلغاء الإعجاب');
});

// ─── الردود ───────────────────────────────────────────────────
const getReplies = asyncHandler(async (req, res) => {
 const page = parseInt(req.query.page) || 1;
 const limit = parseInt(req.query.limit) || 20;
 const replies = await postsService.getReplies(req.params.id, req.user?.id, page, limit);
 respond.ok(res, replies);
});

// ─── تثبيت / إلغاء تثبيت ──────────────────────────────────────
const pinPost = asyncHandler(async (req, res) => {
 await postsService.pinPost(req.params.id, req.user.id);
 respond.ok(res, {}, 'تم تثبيت المنشور');
});

const unpinPost = asyncHandler(async (req, res) => {
 await postsService.unpinPost(req.params.id, req.user.id);
 respond.ok(res, {}, 'تم إلغاء التثبيت');
});

module.exports = { createPost, getPost, deletePost, toggleLike, getReplies, pinPost, unpinPost, votePoll, getPoll };

const votePoll = asyncHandler(async (req, res) => {
 const poll = await voteOnPoll(req.params.id, req.user.id, req.body?.optionId);
 respond.ok(res, poll, 'تم تسجيل التصويت');
});

const getPoll = asyncHandler(async (req, res) => {
 const poll = await getPollForPost(req.params.id, req.user?.id);
 if (!poll) return respond.notFound(res, 'الاستطلاع غير موجود');
 respond.ok(res, poll);
});
