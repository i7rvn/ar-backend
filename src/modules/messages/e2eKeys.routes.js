const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const service = require('./e2eKeys.service');
const { asyncHandler, respond } = require('../../utils/helpers');

const router = express.Router();
router.use(authenticate);

const keySchema = z.object({
 publicKeyJwk: z.record(z.any()),
}).strict();

router.put('/', asyncHandler(async (req, res) => {
 const parsed = keySchema.safeParse(req.body);
 if (!parsed.success) return respond.error(res, 'المفتاح العام غير صالح', 400, 'INVALID_E2E_PUBLIC_KEY');
 const key = await service.registerPublicKey(req.user.id, parsed.data.publicKeyJwk);
 respond.ok(res, key, 'تم تحديث مفتاح E2E');
}));

router.get('/:userId', asyncHandler(async (req, res) => {
 const key = await service.getPublicKey(req.params.userId);
 if (!key) return respond.notFound(res, 'مفتاح E2E غير موجود');
 respond.ok(res, key);
}));

module.exports = router;
