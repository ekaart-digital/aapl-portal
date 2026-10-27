const express = require('express');
const { overview, projectsHealth, projectDetail, exceptions } = require('../controllers/dashboard.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');
const { ApiError } = require('../utils/ApiError');
const { can } = require('../auth/permissions');

const router = express.Router();

router.use(requireAuth);

// Each home dashboard has its own capability; any one of them opens /dashboard.
function requireAnyDashboard(req, res, next) {
  const allowed = ['dashboard.team', 'dashboard.department', 'dashboard.company'].some((c) => can(req.user.role, c));
  return allowed ? next() : next(ApiError.forbidden('Your role does not have a dashboard.'));
}

router.get('/', requireAnyDashboard, overview);
router.get('/projects', requireCapability('manhours.view'), projectsHealth);
router.get('/projects/:projectId', requireCapability('manhours.view'), projectDetail);
router.get('/exceptions', requireCapability('exceptions.view'), exceptions);

module.exports = router;
