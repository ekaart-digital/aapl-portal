const express = require('express');
const { listTeams, createTeam, updateTeam, deleteTeam } = require('../controllers/teams.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', requireCapability('employees.view'), listTeams); // limited to the caller's own teams
router.post('/', requireCapability('structure.manage'), createTeam);
router.patch('/:id', requireCapability('structure.manage'), updateTeam);
router.delete('/:id', requireCapability('structure.manage'), deleteTeam);

module.exports = router;
