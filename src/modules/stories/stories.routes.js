const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const { asyncHandler, respond } = require('../../utils/helpers');
const service = require('./stories.service');

const router = express.Router();
router.use(authenticate);

const createSchema = z.object({
 mediaId: z.string().uuid(),
 caption: z.string().trim().max(280).optional(),
 visibility: z.enum(['public', 'followers']).default('followers'),
}).strict();

router.get('/', asyncHandler(async (req, res) => {
 respond.ok(res, await service.listStories(req.user.id));
}));

router.post('/', asyncHandler(async (req, res) => {
 const parsed = createSchema.safeParse(req.body);
 if (!parsed.success) return respond.error(res, 'بيانات القصة غير صالحة', 400, 'INVALID_STORY');
 const story = await service.createStory(
  req.user.id, parsed.data.mediaId, parsed.data.caption, parsed.data.visibility
 );
 respond.created(res, story, 'تم نشر القصة');
}));

router.get('/:id', asyncHandler(async (req, res) => {
 respond.ok(res, await service.getStory(req.params.id, req.user.id));
}));

router.delete('/:id', asyncHandler(async (req, res) => {
 await service.deleteStory(req.params.id, req.user.id);
 respond.ok(res, {}, 'تم حذف القصة');
}));

module.exports = router;
