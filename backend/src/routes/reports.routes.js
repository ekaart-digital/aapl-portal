const express = require('express');
const { projectDetailsReport, employeeWorkTimeReport, monthlySummary, employeeReport, summaryReport } = require('../controllers/reports.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// A work report: your own, or (with reports.view) someone you are responsible for.
// The handler checks which.
router.get('/employee/:id', employeeReport);

router.use(requireCapability('reports.view'));

router.get('/projects', projectDetailsReport);
router.get('/employee-work-time', employeeWorkTimeReport);
router.get('/monthly', monthlySummary);
router.get('/summary', summaryReport);

module.exports = router;
