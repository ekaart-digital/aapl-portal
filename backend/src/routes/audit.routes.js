const express = require('express');
const { listAudit } = require('../controllers/audit.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireCapability('audit.view'));
router.get('/', listAudit);

module.exports = router;
