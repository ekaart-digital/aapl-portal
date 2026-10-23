// Employee correction requests. An employee who forgot to stop a timer, or
// started it by mistake, asks for a finished session to be credited
// differently. The people responsible for that person's time (their Team
// Leader, Department Head or the project's manager, but never the person
// themselves) approve or reject it. Approving applies the change with the full
// who/when/why trail.

const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { reviewScope, canReviewTimeOf } = require('../auth/scope');
const { notify, reportingLinesOf, fmtMinutes } = require('../services/notifications');
const { record } = require('../services/audit');
const settings = require('../services/settings');
const { applySessionAdjustment, MAX_CORRECTED_MINUTES } = require('./timelogs.controller');

// Older sessions are closed to self-service corrections; a manager can still
// correct them directly. How far back is a setting.
const windowDays = () => settings.get('correctionWindowDays');

function toPublicRequest(row) {
  return {
    id: row.request_id,
    logId: row.log_id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    taskName: row.task_name,
    projectId: row.project_id,
    projectName: row.project_name,
    logDate: row.log_date,
    originalMinutes: row.original_minutes,
    requestedMinutes: row.requested_minutes,
    reason: row.reason,
    status: row.status,
    reviewerName: row.reviewer_name || null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    createdAt: row.created_at,
  };
}

const REQUEST_SELECT = `
  SELECT cr.*, tl.log_date, t.task_name, p.project_id, p.name AS project_name,
         e.name AS employee_name, rv.name AS reviewer_name
    FROM correction_requests cr
    JOIN time_logs tl ON tl.log_id = cr.log_id
    JOIN tasks t ON t.task_id = tl.task_id
    JOIN projects p ON p.project_id = t.project_id
    JOIN employees e ON e.employee_id = cr.employee_id
    LEFT JOIN employees rv ON rv.employee_id = cr.reviewer_id
`;

const cleanReason = (value, label = 'reason') => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 3 || text.length > 500) throw ApiError.badRequest(`A ${label} of 3 to 500 characters is required.`);
  return text;
};

// My finished sessions of the last two weeks, with the state of any request.
const listMySessions = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT tl.log_id, tl.task_id, tl.log_date, tl.duration_minutes, tl.auto_stopped, tl.edited_at, tl.note,
            t.task_name, p.project_id, p.name AS project_name, p.job_code,
            (SELECT cr.status FROM correction_requests cr WHERE cr.log_id = tl.log_id ORDER BY cr.request_id DESC LIMIT 1) AS request_status
       FROM time_logs tl
       JOIN tasks t ON t.task_id = tl.task_id
       JOIN projects p ON p.project_id = t.project_id
      WHERE tl.employee_id = ? AND tl.end_time IS NOT NULL AND tl.log_date >= CURDATE() - INTERVAL ? DAY
      ORDER BY tl.start_time DESC`,
    [req.user.id, windowDays()]
  );
  res.json({
    windowDays: windowDays(),
    sessions: rows.map((r) => ({
      id: r.log_id,
      taskId: r.task_id,
      taskName: r.task_name,
      projectId: r.project_id,
      projectName: r.project_name,
      projectJobCode: r.job_code,
      logDate: r.log_date,
      durationMinutes: r.duration_minutes,
      autoStopped: Boolean(r.auto_stopped),
      adjusted: r.edited_at != null,
      note: r.note || null,
      requestStatus: r.request_status || null,
    })),
  });
});

const listMine = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`${REQUEST_SELECT} WHERE cr.employee_id = ? ORDER BY cr.request_id DESC LIMIT 100`, [req.user.id]);
  res.json({ requests: rows.map(toPublicRequest) });
});

const createRequest = asyncHandler(async (req, res) => {
  const { logId, durationMinutes } = req.body;
  const reason = cleanReason(req.body.reason);

  if (!Number.isInteger(logId)) throw ApiError.badRequest('logId must be a number.');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > MAX_CORRECTED_MINUTES) {
    throw ApiError.badRequest(`durationMinutes must be a whole number between 0 and ${MAX_CORRECTED_MINUTES}.`);
  }

  const [rows] = await pool.query(
    `SELECT tl.*, t.task_name, t.project_id, p.name AS project_name, DATEDIFF(CURDATE(), tl.log_date) AS age_days
       FROM time_logs tl JOIN tasks t ON t.task_id = tl.task_id JOIN projects p ON p.project_id = t.project_id
      WHERE tl.log_id = ?`,
    [logId]
  );
  const log = rows[0];
  if (!log) throw ApiError.notFound('Time log not found.');
  if (log.employee_id !== req.user.id) throw ApiError.forbidden('You can only ask for a correction to your own time.');
  if (log.end_time === null) throw ApiError.conflict('This session is still running. Stop the timer first.');
  if (Number(log.age_days) > windowDays()) {
    throw ApiError.badRequest(`Sessions older than ${windowDays()} days can only be corrected by your manager.`);
  }
  if (durationMinutes === log.duration_minutes) throw ApiError.badRequest('That is the time already recorded for this session.');

  const [pending] = await pool.query("SELECT 1 FROM correction_requests WHERE log_id = ? AND status = 'pending'", [logId]);
  if (pending.length) throw ApiError.conflict('This session already has a request waiting for a decision.');

  const [result] = await pool.query(
    `INSERT INTO correction_requests (log_id, employee_id, original_minutes, requested_minutes, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [logId, req.user.id, log.duration_minutes, durationMinutes, reason]
  );

  const lines = await reportingLinesOf(req.user.id);
  const [[pm]] = await pool.query('SELECT project_manager_id FROM projects WHERE project_id = ?', [log.project_id]);
  // The people who can decide: not the requester themselves.
  const reviewers = [lines.teamLeaderId, lines.departmentHeadId, pm.project_manager_id].filter((id) => id && id !== req.user.id);
  await notify({
    recipientIds: reviewers,
    type: 'correction-requested',
    severity: 'attention',
    title: 'A time correction needs your decision',
    body: `${req.user.name} asked to change a session on "${log.task_name}" (${log.project_name}) from ${fmtMinutes(log.duration_minutes)} to ${fmtMinutes(durationMinutes)}. Reason: ${reason}`,
    link: '/approvals',
    dedupeKey: `correction:${result.insertId}`,
  });
  await record(req.user, {
    action: 'correction.request',
    entityType: 'correction',
    entityId: result.insertId,
    summary: `${req.user.name} requested a correction on "${log.task_name}" (${log.project_name}): ${fmtMinutes(log.duration_minutes)} to ${fmtMinutes(durationMinutes)}`,
    details: { logId, from: log.duration_minutes, to: durationMinutes, reason },
  });

  const [created] = await pool.query(`${REQUEST_SELECT} WHERE cr.request_id = ?`, [result.insertId]);
  res.status(201).json({ request: toPublicRequest(created[0]) });
});

// The review queue: requests from the people this user is responsible for.
const listForReview = asyncHandler(async (req, res) => {
  const status = req.query.status === 'all' ? null : 'pending';
  const scope = reviewScope(req.user, 'e', 'p');
  const [rows] = await pool.query(
    `${REQUEST_SELECT} WHERE ${status ? 'cr.status = ? AND ' : ''}${scope.sql} ORDER BY cr.status = 'pending' DESC, cr.request_id DESC LIMIT 200`,
    [...(status ? [status] : []), ...scope.params]
  );
  res.json({ requests: rows.map(toPublicRequest) });
});

async function loadForDecision(req) {
  const [rows] = await pool.query(
    `${REQUEST_SELECT.replace('SELECT cr.*,', 'SELECT cr.*, e.department_id, e.team_id,')} WHERE cr.request_id = ?`,
    [req.params.id]
  );
  const request = rows[0];
  if (!request) throw ApiError.notFound('Correction request not found.');
  const allowed = await canReviewTimeOf(req.user, { employee_id: request.employee_id, department_id: request.department_id, team_id: request.team_id }, request.project_id);
  if (!allowed) {
    throw ApiError.forbidden(request.employee_id === req.user.id
      ? 'You cannot decide your own correction request.'
      : 'You are not responsible for reviewing this person\'s time.');
  }
  if (request.status !== 'pending') throw ApiError.conflict(`This request was already ${request.status}.`);
  return request;
}

const approve = asyncHandler(async (req, res) => {
  const request = await loadForDecision(req);
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  const [[log]] = await pool.query('SELECT * FROM time_logs WHERE log_id = ?', [request.log_id]);
  if (log.duration_minutes !== request.original_minutes) {
    throw ApiError.conflict('This session was changed after the request was made. Ask the employee to submit a new request.');
  }

  await applySessionAdjustment({
    log,
    durationMinutes: request.requested_minutes,
    note: `Correction requested by the employee and approved: ${request.reason}`.slice(0, 500),
    actor: req.user,
    via: 'correction-request',
  });
  await pool.query(
    "UPDATE correction_requests SET status = 'approved', reviewer_id = ?, reviewed_at = NOW(), review_note = ? WHERE request_id = ?",
    [req.user.id, note || null, request.request_id]
  );
  await notify({
    recipientIds: request.employee_id,
    type: 'correction-approved',
    title: 'Your time correction was approved',
    body: `Your session on "${request.task_name}" is now ${fmtMinutes(request.requested_minutes)} (was ${fmtMinutes(request.original_minutes)}).${note ? ` Note: ${note}` : ''}`,
    link: '/my-time',
  });
  await record(req.user, {
    action: 'correction.approve',
    entityType: 'correction',
    entityId: request.request_id,
    summary: `Approved ${request.employee_name}'s correction on "${request.task_name}" (${request.project_name})`,
    details: { logId: request.log_id, from: request.original_minutes, to: request.requested_minutes, note },
  });

  const [updated] = await pool.query(`${REQUEST_SELECT} WHERE cr.request_id = ?`, [request.request_id]);
  res.json({ request: toPublicRequest(updated[0]) });
});

const reject = asyncHandler(async (req, res) => {
  const request = await loadForDecision(req);
  const note = cleanReason(req.body.note, 'note explaining the decision');

  await pool.query(
    "UPDATE correction_requests SET status = 'rejected', reviewer_id = ?, reviewed_at = NOW(), review_note = ? WHERE request_id = ?",
    [req.user.id, note, request.request_id]
  );
  await notify({
    recipientIds: request.employee_id,
    type: 'correction-rejected',
    severity: 'attention',
    title: 'Your time correction was not approved',
    body: `Your request to change a session on "${request.task_name}" was declined. Note: ${note}`,
    link: '/my-time',
  });
  await record(req.user, {
    action: 'correction.reject',
    entityType: 'correction',
    entityId: request.request_id,
    summary: `Rejected ${request.employee_name}'s correction on "${request.task_name}" (${request.project_name})`,
    details: { logId: request.log_id, note },
  });

  const [updated] = await pool.query(`${REQUEST_SELECT} WHERE cr.request_id = ?`, [request.request_id]);
  res.json({ request: toPublicRequest(updated[0]) });
});

module.exports = { listMySessions, listMine, createRequest, listForReview, approve, reject };
