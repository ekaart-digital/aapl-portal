const express = require('express');
const { listFlagged, adjustSession } = require('../controllers/timelogs.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireCapability('sessions.review'));

router.get('/flagged', listFlagged);
router.patch('/:logId', adjustSession);

module.exports = router;
