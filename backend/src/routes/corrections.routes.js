const express = require('express');
const { listMySessions, listMine, createRequest, listForReview, approve, reject } = require('../controllers/corrections.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Asking for a correction: the people who work on tasks.
router.get('/sessions', requireCapability('corrections.request'), listMySessions);
router.get('/mine', requireCapability('corrections.request'), listMine);
router.post('/', requireCapability('corrections.request'), createRequest);

// Deciding on one: the people who review time.
router.get('/', requireCapability('sessions.review'), listForReview);
router.post('/:id/approve', requireCapability('sessions.review'), approve);
router.post('/:id/reject', requireCapability('sessions.review'), reject);

module.exports = router;
