const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const service = require('./wordFilters.service');

const router = express.Router();
router.use(authenticate);

const createSchema = z.object({
  phrase: z.string().trim().min(1).max(80),
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
}).strict();

router.get('/', async (req, res) => {
  const filters = await service.listFilters(req.user.id);
  res.json({ success: true, filters });
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'بيانات الفلتر غير صالحة', code: 'INVALID_FILTER' });
  }
  const filter = await service.addFilter(req.user.id, parsed.data.phrase, parsed.data.durationDays);
  res.status(201).json({ success: true, filter });
});

router.delete('/:id', async (req, res) => {
  await service.removeFilter(req.user.id, req.params.id);
  res.json({ success: true, message: 'تم حذف الفلتر' });
});

module.exports = router;
