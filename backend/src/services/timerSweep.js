const pool = require('../config/db');
const { maxSessionMinutes } = require('../config/timer');
const { notifyAutoStopped, checkProjectBudget, generateDueNotifications, generateSummaryNotifications, purgeOldNotifications } = require('./notifications');
const { record } = require('./audit');
const settings = require('./settings');

// Closes sessions that have been running longer than the allowed maximum,
// crediting exactly the maximum and flagging them for manager review. The
// employee and the project manager are notified. Pass an employeeId to close
// only that person's stale session. Returns how many sessions were closed.
async function autoStopStaleSessions(employeeId) {
  const cap = maxSessionMinutes();
  const params = [cap];
  let where = 'tl.end_time IS NULL AND tl.start_time < NOW() - INTERVAL ? MINUTE';
  if (employeeId) {
    where += ' AND tl.employee_id = ?';
    params.push(employeeId);
  }

  const [stale] = await pool.query(
    `SELECT tl.log_id, tl.employee_id, t.task_name, p.project_id, p.name AS project_name,
            p.project_manager_id, e.name AS employee_name
       FROM time_logs tl
       JOIN tasks t ON t.task_id = tl.task_id
       JOIN projects p ON p.project_id = t.project_id
       JOIN employees e ON e.employee_id = tl.employee_id
      WHERE ${where}`,
    params
  );
  if (!stale.length) return 0;

  const [result] = await pool.query(
    `UPDATE time_logs
        SET end_time = start_time + INTERVAL ? MINUTE,
            duration_minutes = ?,
            auto_stopped = 1
      WHERE log_id IN (?) AND end_time IS NULL`,
    [cap, cap, stale.map((r) => r.log_id)]
  );

  for (const r of stale) {
    await record(null, {
      action: 'time-log.auto-stop',
      entityType: 'time-log',
      entityId: r.log_id,
      summary: `Stopped ${r.employee_name}'s timer on "${r.task_name}" (${r.project_name}) at the ${Math.round(cap / 60)}-hour limit`,
      details: { employeeId: r.employee_id, creditedMinutes: cap, projectId: r.project_id },
    });
  }
  await notifyAutoStopped(stale);
  for (const projectId of new Set(stale.map((r) => r.project_id))) await checkProjectBudget(projectId);
  return result.affectedRows;
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const DAILY_JOBS_INTERVAL_MS = 60 * 60 * 1000;

// What the background jobs last did, for the System Administrator's health screen.
const status = { startedAt: null, lastSweepAt: null, lastSweepStopped: 0, lastSweepError: null, lastDailyAt: null, lastDailyError: null };
const getSweepStatus = () => ({ ...status });

function startSweepSchedule() {
  status.startedAt = new Date();
  const sweep = () => settings.load().then(() => autoStopStaleSessions()).then(
    (n) => {
      Object.assign(status, { lastSweepAt: new Date(), lastSweepStopped: n, lastSweepError: null });
      if (n) console.log(`Auto-stopped ${n} stale timer session(s).`);
    },
    (err) => {
      Object.assign(status, { lastSweepAt: new Date(), lastSweepError: err.message });
      console.error('Timer sweep failed:', err.message);
    }
  );
  const hourly = () => Promise.all([generateDueNotifications(), generateSummaryNotifications(), purgeOldNotifications()]).then(
    () => Object.assign(status, { lastDailyAt: new Date(), lastDailyError: null }),
    (err) => {
      Object.assign(status, { lastDailyAt: new Date(), lastDailyError: err.message });
      console.error('Notification job failed:', err.message);
    }
  );

  sweep();
  hourly();
  const timers = [setInterval(sweep, SWEEP_INTERVAL_MS), setInterval(hourly, DAILY_JOBS_INTERVAL_MS)];
  timers.forEach((t) => t.unref());
  return timers;
}

module.exports = { autoStopStaleSessions, startSweepSchedule, getSweepStatus };
