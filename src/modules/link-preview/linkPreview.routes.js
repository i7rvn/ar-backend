const express = require('express');
const { getLinkPreview } = require('./linkPreview.service');
const { asyncHandler, respond } = require('../../utils/helpers');
const { optionalAuthenticate } = require('../../middleware/optionalAuth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const previewLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'طلبات معاينة كثيرة، حاول لاحقاً' },
});

router.get('/', optionalAuthenticate, previewLimiter, asyncHandler(async (req, res) => {
  const preview = await getLinkPreview(String(req.query.url || ''));
  respond.ok(res, preview);
}));

module.exports = router;
