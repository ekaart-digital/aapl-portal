const express = require('express');
const {
  listProjects, getProject, createProject, updateProject, listAssignees, listProjectManagers, listTeamLeaders,
} = require('../controllers/projects.controller');
const { listTasksForProject, assignTask } = require('../controllers/tasks.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Each handler limits what is returned or changed to the caller's own scope.
router.get('/', requireCapability('projects.view'), listProjects);
router.get('/project-managers', requireCapability('projects.create'), listProjectManagers);
router.get('/team-leaders', requireCapability('projects.create'), listTeamLeaders);
router.post('/', requireCapability('projects.create'), createProject);
router.get('/:id', requireCapability('projects.view'), getProject);
router.patch('/:id', requireCapability('projects.edit'), updateProject);

// Task sub-resource
router.get('/:projectId/tasks', requireCapability('projects.view'), listTasksForProject);
router.get('/:projectId/assignees', requireCapability('tasks.allocate'), listAssignees);
router.post('/:projectId/tasks', requireCapability('tasks.allocate'), assignTask);

module.exports = router;
