const express = require('express');
const searchService = require('./search.service');
const { respond, asyncHandler } = require('../../utils/helpers');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
 const { q, type = 'all', page = 1, limit = 20 } = req.query;

 if (!q || q.trim().length < 2) {
 return respond.error(res, 'الكلمة قصيرة جداً، أدخل حرفين على الأقل', 400);
 }

 const results = await searchService.search(
 q.trim(), type,
 parseInt(page),
 parseInt(limit)
 );

 respond.ok(res, results);
}));

module.exports = router;
