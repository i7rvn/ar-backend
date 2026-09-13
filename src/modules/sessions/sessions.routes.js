const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const sessionsService = require('./sessions.service');

router.get('/', authenticate, async (req, res) => {
 const devices = await sessionsService.listUserDevices(req.user.id);
 res.json({ success: true, devices });
});

router.delete('/:deviceId', authenticate, async (req, res) => {
 await sessionsService.revokeDevice(req.user.id, req.params.deviceId);
 res.json({ success: true, message: 'تم تسجيل الخروج من هذا الجهاز' });
});

router.post('/revoke-all', authenticate, async (req, res) => {
 await sessionsService.revokeAllDevicesExceptCurrent(req.user.id);
 res.json({ success: true, message: 'تم تسجيل الخروج من كل الأجهزة الأخرى' });
});

module.exports = router;
