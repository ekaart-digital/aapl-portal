const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { autoStopStaleSessions } = require('../services/timerSweep');
const { dashboardFor, projectHealth, projectManHours, exceptionsFor } = require('../services/insight');

// The home dashboard of a Team Leader, Department Head or Management user.
const overview = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  res.json(await dashboardFor(req.user));
});

// Man-hour health of every project the caller can see (SRS §26).
const projectsHealth = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  res.json({ projects: await projectHealth(req.user) });
});

const projectDetail = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  const result = await projectManHours(req.user, req.params.projectId);
  if (!result) throw ApiError.notFound('Project not found.');
  res.json({ project: result });
});

// The exception screen (SRS §30). Optional filters: severity, type.
const exceptions = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  const { severity, type } = req.query;
  let items = await exceptionsFor(req.user);
  if (severity) items = items.filter((i) => i.severity === severity);
  if (type) items = items.filter((i) => i.type === type);
  res.json({ exceptions: items });
});

module.exports = { overview, projectsHealth, projectDetail, exceptions };
