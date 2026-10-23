const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { maxSessionMinutes } = require('../config/timer');
const { autoStopStaleSessions } = require('../services/timerSweep');
const { taskScope, reviewScope, canReviewTimeOf } = require('../auth/scope');
const { notify, notifyAutoStopped, checkProjectBudget, fmtMinutes } = require('../services/notifications');
const { record } = require('../services/audit');

const MAX_CORRECTED_MINUTES = 24 * 60;

function toPublicLog(row) {
  return {
    id: row.log_id,
    taskId: row.task_id,
    employeeId: row.employee_id,
    startTime: row.start_time,
    endTime: row.end_time,
    durationMinutes: row.duration_minutes,
    logDate: row.log_date,
    isOpen: row.end_time === null,
    // Seconds the session has been running, measured by the database clock so
    // clients don't need to interpret DATETIME strings in any timezone.
    elapsedSeconds: row.end_time === null ? Number(row.elapsed_seconds || 0) : null,
    autoStopped: Boolean(row.auto_stopped),
    needsReview: Boolean(row.auto_stopped) && row.edited_at == null,
    note: row.note || null,
    editedAt: row.edited_at || null,
    editedByName: row.edited_by_name || null,
  };
}

const startSession = asyncHandler(async (req, res) => {
  const taskId = req.params.id;

  const [taskRows] = await pool.query('SELECT * FROM tasks WHERE task_id = ?', [taskId]);
  const task = taskRows[0];
  if (!task) throw ApiError.notFound('Task not found.');
  if (task.employee_id !== req.user.id) throw ApiError.forbidden('You can only start the timer on your own tasks.');
  if (task.status === 'Completed') throw ApiError.conflict('This task is completed. Ask your manager to reopen it.');

  // A forgotten timer past the limit must not block starting new work.
  await autoStopStaleSessions(req.user.id);

  const [openRows] = await pool.query('SELECT log_id, task_id FROM time_logs WHERE employee_id = ? AND end_time IS NULL', [req.user.id]);
  if (openRows.length) {
    throw ApiError.conflict(`You already have a running timer on task #${openRows[0].task_id}. Stop it before starting another.`);
  }

  const [result] = await pool.query(
    `INSERT INTO time_logs (task_id, employee_id, start_time, log_date) VALUES (?, ?, NOW(), CURDATE())`,
    [taskId, req.user.id]
  );

  // Starting work picks a task back up, whatever state it was left in.
  if (['Not Started', 'Partially Completed', 'Awaiting Input'].includes(task.status)) {
    await pool.query("UPDATE tasks SET status = 'In Progress' WHERE task_id = ?", [taskId]);
  }

  const [rows] = await pool.query('SELECT *, TIMESTAMPDIFF(SECOND, start_time, NOW()) AS elapsed_seconds FROM time_logs WHERE log_id = ?', [result.insertId]);
  res.status(201).json({ timeLog: toPublicLog(rows[0]) });
});

const stopSession = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT *, TIMESTAMPDIFF(MINUTE, start_time, NOW()) AS elapsed_minutes FROM time_logs WHERE log_id = ?',
    [req.params.logId]
  );
  const log = rows[0];
  if (!log) throw ApiError.notFound('Time log not found.');
  if (log.employee_id !== req.user.id) throw ApiError.forbidden('You can only stop your own timer.');
  if (log.end_time !== null) throw ApiError.conflict('This session is already stopped.');

  const cap = maxSessionMinutes();
  if (Number(log.elapsed_minutes) > cap) {
    // Left running past the limit: credit the limit only, and flag for review.
    await pool.query(
      `UPDATE time_logs
          SET end_time = start_time + INTERVAL ? MINUTE, duration_minutes = ?, auto_stopped = 1
        WHERE log_id = ?`,
      [cap, cap, req.params.logId]
    );
  } else {
    await pool.query(
      `UPDATE time_logs
          SET end_time = NOW(), duration_minutes = GREATEST(1, TIMESTAMPDIFF(MINUTE, start_time, NOW()))
        WHERE log_id = ?`,
      [req.params.logId]
    );
  }

  const [updated] = await pool.query('SELECT * FROM time_logs WHERE log_id = ?', [req.params.logId]);

  const [[context]] = await pool.query(
    `SELECT t.task_name, t.project_id, p.name AS project_name, p.project_manager_id, e.name AS employee_name
       FROM tasks t JOIN projects p ON p.project_id = t.project_id JOIN employees e ON e.employee_id = ?
      WHERE t.task_id = ?`,
    [log.employee_id, log.task_id]
  );
  if (updated[0].auto_stopped) {
    await record(null, {
      action: 'time-log.auto-stop',
      entityType: 'time-log',
      entityId: log.log_id,
      summary: `Stopped ${context.employee_name}'s timer on "${context.task_name}" (${context.project_name}) at the ${Math.round(cap / 60)}-hour limit`,
      details: { employeeId: log.employee_id, creditedMinutes: cap, projectId: context.project_id },
    });
    await notifyAutoStopped([{ log_id: log.log_id, employee_id: log.employee_id, ...context }]);
  }
  await checkProjectBudget(context.project_id);

  res.json({ timeLog: toPublicLog(updated[0]), maxSessionMinutes: cap });
});

const logsForTask = asyncHandler(async (req, res) => {
  const [taskRows] = await pool.query('SELECT task_id FROM tasks WHERE task_id = ?', [req.params.id]);
  if (!taskRows.length) throw ApiError.notFound('Task not found.');

  // Anyone who may see the task may see the time logged on it.
  const scope = taskScope(req.user);
  const [visible] = await pool.query(
    `SELECT 1 FROM tasks t
       JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
       JOIN departments d ON d.department_id = sd.department_id
       JOIN employees emp ON emp.employee_id = t.employee_id
       JOIN projects p ON p.project_id = t.project_id
      WHERE t.task_id = ? AND ${scope.sql}`,
    [req.params.id, ...scope.params]
  );
  if (!visible.length) throw ApiError.forbidden('You cannot view the time logged on this task.');

  const [rows] = await pool.query(
    `SELECT tl.*, ed.name AS edited_by_name
       FROM time_logs tl
       LEFT JOIN employees ed ON ed.employee_id = tl.edited_by
      WHERE tl.task_id = ?
      ORDER BY tl.start_time DESC`,
    [req.params.id]
  );
  res.json({ timeLogs: rows.map(toPublicLog) });
});

const myOpenSession = asyncHandler(async (req, res) => {
  await autoStopStaleSessions(req.user.id);

  const [rows] = await pool.query(
    'SELECT *, TIMESTAMPDIFF(SECOND, start_time, NOW()) AS elapsed_seconds FROM time_logs WHERE employee_id = ? AND end_time IS NULL',
    [req.user.id]
  );

  // Tell the employee when a timer they left running was closed for them.
  const [stopped] = await pool.query(
    `SELECT tl.*, t.task_name
       FROM time_logs tl JOIN tasks t ON t.task_id = tl.task_id
      WHERE tl.employee_id = ? AND tl.auto_stopped = 1 AND tl.edited_at IS NULL
        AND tl.log_date >= CURDATE() - INTERVAL 7 DAY
      ORDER BY tl.start_time DESC LIMIT 1`,
    [req.user.id]
  );

  res.json({
    openSession: rows[0] ? toPublicLog(rows[0]) : null,
    autoStoppedSession: stopped[0] ? { ...toPublicLog(stopped[0]), taskName: stopped[0].task_name } : null,
    maxSessionMinutes: maxSessionMinutes(),
  });
});

// Review queue: sessions the system closed that nobody has checked yet, limited
// to the people this reviewer is responsible for.
const listFlagged = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  const scope = reviewScope(req.user, 'e', 'p');
  const [rows] = await pool.query(
    `SELECT tl.*, t.task_name, p.project_id, p.name AS project_name, p.job_code, e.name AS employee_name
       FROM time_logs tl
       JOIN tasks t ON t.task_id = tl.task_id
       JOIN projects p ON p.project_id = t.project_id
       JOIN employees e ON e.employee_id = tl.employee_id
      WHERE tl.auto_stopped = 1 AND tl.edited_at IS NULL AND ${scope.sql}
      ORDER BY tl.start_time DESC
      LIMIT 200`,
    scope.params
  );
  res.json({
    timeLogs: rows.map((r) => ({
      ...toPublicLog(r),
      taskName: r.task_name,
      projectId: r.project_id,
      projectName: r.project_name,
      projectJobCode: r.job_code,
      employeeName: r.employee_name,
    })),
    maxSessionMinutes: maxSessionMinutes(),
  });
});

// Sets the credited length of a finished session and records who changed it
// and why. Shared by a manager's direct correction and by the approval of an
// employee's correction request.
async function applySessionAdjustment({ log, durationMinutes, note, actor, via = 'manager' }) {
  await pool.query(
    `UPDATE time_logs
        SET end_time = start_time + INTERVAL ? MINUTE, duration_minutes = ?,
            edited_by = ?, edited_at = NOW(), note = ?
      WHERE log_id = ?`,
    [durationMinutes, durationMinutes, actor.id, note, log.log_id]
  );
  const [[context]] = await pool.query(
    `SELECT t.task_name, t.project_id, p.name AS project_name, e.name AS employee_name
       FROM tasks t JOIN projects p ON p.project_id = t.project_id JOIN employees e ON e.employee_id = ?
      WHERE t.task_id = ?`,
    [log.employee_id, log.task_id]
  );
  await record(actor, {
    action: 'time-log.adjust',
    entityType: 'time-log',
    entityId: log.log_id,
    summary: `Changed ${context.employee_name}'s session on "${context.task_name}" (${context.project_name}) from ${fmtMinutes(log.duration_minutes)} to ${fmtMinutes(durationMinutes)}`,
    details: { from: log.duration_minutes, to: durationMinutes, note, via, projectId: context.project_id, employeeId: log.employee_id },
  });
  await checkProjectBudget(context.project_id);
  return context;
}

// Manager correction: set the credited length of a finished session. A note is
// required so every change can be explained later; 0 minutes voids a session
// while keeping the record. Also used to approve a flagged session as it is.
const adjustSession = asyncHandler(async (req, res) => {
  const { durationMinutes, note } = req.body;

  if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > MAX_CORRECTED_MINUTES) {
    throw ApiError.badRequest(`durationMinutes must be a whole number between 0 and ${MAX_CORRECTED_MINUTES}.`);
  }
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw ApiError.badRequest('A note of 3 to 500 characters explaining the change is required.');
  }

  const [rows] = await pool.query('SELECT * FROM time_logs WHERE log_id = ?', [req.params.logId]);
  const log = rows[0];
  if (!log) throw ApiError.notFound('Time log not found.');

  // Only the person's Team Leader, Department Head, or the project's manager.
  const [ctx] = await pool.query(
    `SELECT e.employee_id, e.department_id, e.team_id, t.project_id
       FROM time_logs tl JOIN employees e ON e.employee_id = tl.employee_id JOIN tasks t ON t.task_id = tl.task_id
      WHERE tl.log_id = ?`,
    [req.params.logId]
  );
  if (!(await canReviewTimeOf(req.user, ctx[0], ctx[0].project_id))) {
    throw ApiError.forbidden('You are not responsible for reviewing this person\'s time.');
  }
  if (log.end_time === null) throw ApiError.conflict('This session is still running. It can be corrected once it has been stopped.');

  const context = await applySessionAdjustment({ log, durationMinutes, note: trimmed, actor: req.user });

  const [updated] = await pool.query(
    `SELECT tl.*, ed.name AS edited_by_name
       FROM time_logs tl LEFT JOIN employees ed ON ed.employee_id = tl.edited_by
      WHERE tl.log_id = ?`,
    [req.params.logId]
  );
  await notify({
    recipientIds: log.employee_id,
    type: 'session-adjusted',
    title: 'A manager adjusted your logged time',
    body: `Your session on "${context.task_name}" (${log.log_date}) was changed from ${fmtMinutes(log.duration_minutes)} to ${fmtMinutes(durationMinutes)}. Reason: ${trimmed}`,
    link: '/my-progress',
  });

  res.json({ timeLog: toPublicLog(updated[0]) });
});

module.exports = { startSession, stopSession, logsForTask, myOpenSession, listFlagged, adjustSession, applySessionAdjustment, toPublicLog, MAX_CORRECTED_MINUTES };
