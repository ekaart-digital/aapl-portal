const express = require('express');
const { listSettings, updateSettings, health } = require('../controllers/system.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/settings', requireCapability('settings.manage'), listSettings);
router.patch('/settings', requireCapability('settings.manage'), updateSettings);
router.get('/health', requireCapability('system.health'), health);

module.exports = router;
