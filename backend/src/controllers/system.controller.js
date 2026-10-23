const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const settings = require('../services/settings');
const { record } = require('../services/audit');
const { getSweepStatus } = require('../services/timerSweep');
const { ROLE_LABELS } = require('../auth/permissions');

const APP_VERSION = require('../../package.json').version;

const listSettings = asyncHandler(async (req, res) => {
  res.json({ settings: await settings.describeAll() });
});

// PATCH /api/system/settings { maxSessionHours: 10, ... } — saves only what changed.
const updateSettings = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) throw ApiError.badRequest('Send at least one setting to change.');

  const values = {};
  for (const key of keys) {
    if (!settings.KEYS.includes(key)) throw ApiError.badRequest(`Unknown setting: ${key}.`);
    const checked = settings.validate(key, body[key]);
    if (checked.error) throw ApiError.badRequest(checked.error);
    values[key] = checked.value;
  }

  // The warning level has to stay below the limit.
  const warn = values.budgetWarnPercent ?? settings.get('budgetWarnPercent');
  const limit = values.budgetCriticalPercent ?? settings.get('budgetCriticalPercent');
  if (warn >= limit) throw ApiError.badRequest('The man-hour warning level must be lower than the man-hour limit.');

  const before = {};
  for (const key of keys) before[key] = settings.get(key);
  const diff = {};
  for (const key of keys) {
    if (values[key] === before[key]) continue;
    await settings.save(key, values[key], req.user.id);
    diff[key] = { from: String(before[key]), to: String(values[key]) };
    await record(req.user, {
      action: 'settings.update',
      entityType: 'settings',
      summary: `Changed "${settings.DEFINITIONS[key].label}" from ${before[key]} to ${values[key]} ${settings.DEFINITIONS[key].unit}`,
      details: { key, from: before[key], to: values[key] },
    });
  }

  res.json({ settings: await settings.describeAll(), changed: Object.keys(diff) });
});

// How the system is doing: database, background jobs, and what is in it.
const health = asyncHandler(async (req, res) => {
  const started = Date.now();
  let database = { ok: true, latencyMs: 0, error: null };
  try {
    await pool.query('SELECT 1');
    database.latencyMs = Date.now() - started;
  } catch (err) {
    database = { ok: false, latencyMs: null, error: err.message };
  }

  let counts = null;
  if (database.ok) {
    const [[row]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM employees WHERE status = 'active') AS active_people,
         (SELECT COUNT(*) FROM employees WHERE status = 'inactive') AS inactive_people,
         (SELECT COUNT(*) FROM projects WHERE status <> 'Completed') AS active_projects,
         (SELECT COUNT(*) FROM tasks WHERE status <> 'Completed') AS open_tasks,
         (SELECT COUNT(*) FROM time_logs WHERE end_time IS NULL) AS running_timers,
         (SELECT COUNT(*) FROM time_logs WHERE auto_stopped = 1 AND edited_at IS NULL) AS unreviewed_sessions,
         (SELECT COUNT(*) FROM correction_requests WHERE status = 'pending') AS pending_corrections,
         (SELECT COUNT(*) FROM audit_log WHERE created_at >= NOW() - INTERVAL 1 DAY) AS audit_entries_today,
         (SELECT COUNT(*) FROM audit_log WHERE action = 'auth.login-failed' AND created_at >= NOW() - INTERVAL 1 DAY) AS failed_logins_today`
    );
    const [roles] = await pool.query("SELECT role, COUNT(*) AS n FROM employees WHERE status = 'active' GROUP BY role");
    counts = {
      activePeople: Number(row.active_people),
      inactivePeople: Number(row.inactive_people),
      activeProjects: Number(row.active_projects),
      openTasks: Number(row.open_tasks),
      runningTimers: Number(row.running_timers),
      unreviewedSessions: Number(row.unreviewed_sessions),
      pendingCorrections: Number(row.pending_corrections),
      auditEntriesToday: Number(row.audit_entries_today),
      failedLoginsToday: Number(row.failed_logins_today),
      peopleByRole: roles.map((r) => ({ role: r.role, label: ROLE_LABELS[r.role] || r.role, count: Number(r.n) })),
    };
  }

  const jobs = getSweepStatus();
  const healthy = database.ok && !jobs.lastSweepError && !jobs.lastDailyError;
  res.json({
    status: healthy ? 'ok' : 'degraded',
    checkedAt: new Date(),
    version: APP_VERSION,
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    database,
    jobs,
    counts,
  });
});

module.exports = { listSettings, updateSettings, health };
