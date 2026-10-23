const express = require('express');
const { listNotifications, unreadCount, markRead, markAllRead } = require('../controllers/notifications.controller');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.post('/read-all', markAllRead);
router.patch('/:id/read', markRead);

module.exports = router;
