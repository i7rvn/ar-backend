const express = require('express');
const { getLinkPreview } = require('./linkPreview.service');
const { asyncHandler, respond } = require('../../utils/helpers');
const { z } = require('zod');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const urlSchema = z.object({ url: z.string().url().max(2048) }).strict();

const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'طلبات معاينة كثيرة، حاول لاحقاً' },
});

router.get('/', optionalAuthenticate, previewLimiter, asyncHandler(async (req, res) => {
  const parsed = urlSchema.safeParse({ url: req.query.url });
  if (!parsed.success) return respond.error(res, 'الرابط غير صالح', 400, 'INVALID_URL');
  const preview = await getLinkPreview(parsed.data.url);
  respond.ok(res, preview);
}));

module.exports = router;
