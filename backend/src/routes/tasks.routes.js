const express = require('express');
const { listMyTasks, getTask, updateTask, listCategories } = require('../controllers/tasks.controller');
const { startSession, stopSession, logsForTask, myOpenSession } = require('../controllers/timelogs.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// "My work" belongs to the roles that are given tasks.
router.get('/mine', requireCapability('my-work'), listMyTasks);
router.get('/my-open-session', requireCapability('my-work'), myOpenSession);
router.get('/categories', requireCapability('projects.view'), listCategories);

// Roles with no project data (HR/Admin, System Administrator) are turned away
// here; everyone else is limited inside the handler to their own scope.
router.get('/:id', requireCapability('projects.view'), getTask);
router.patch('/:id', requireCapability('projects.view'), updateTask);

router.get('/:id/time-logs', requireCapability('projects.view'), logsForTask);
router.post('/:id/time-logs/start', requireCapability('my-work'), startSession);
router.post('/:id/time-logs/:logId/stop', requireCapability('my-work'), stopSession);

module.exports = router;
