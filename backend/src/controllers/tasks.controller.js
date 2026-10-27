const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { taskScope, assertCanViewProject, canAllocateTo } = require('../auth/scope');
const { TASK_HOLDER_ROLES } = require('../auth/permissions');
const { autoStopStaleSessions } = require('../services/timerSweep');
const { notify, reportingLinesOf } = require('../services/notifications');
const { record, changes } = require('../services/audit');
const { TASK_CATEGORIES } = require('../config/categories');
const { featureOn } = require('../config/rollout');

const TASK_STATUSES = ['Not Started', 'In Progress', 'Partially Completed', 'Awaiting Input', 'On Hold', 'Completed'];

const BASE_SELECT = `
  SELECT t.*, sd.name AS sub_department_name, d.department_id AS department_id, d.name AS department_name,
         emp.name AS employee_name, p.name AS project_name, p.job_code AS project_job_code,
         COALESCE(SUM(tl.duration_minutes), 0) / 60 AS completed_hours
  FROM tasks t
  JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
  JOIN departments d ON d.department_id = sd.department_id
  JOIN employees emp ON emp.employee_id = t.employee_id
  JOIN projects p ON p.project_id = t.project_id
  LEFT JOIN time_logs tl ON tl.task_id = t.task_id
`;

// The assignee must be an active Employee or Team Leader of the task's
// department. Returns their record for the permission checks that follow.
async function assertAssignableEmployee(employeeId, departmentId) {
  const [empRows] = await pool.query('SELECT employee_id, department_id, team_id, role, status FROM employees WHERE employee_id = ?', [employeeId]);
  const employee = empRows[0];
  if (!employee) throw ApiError.badRequest('Employee not found.');
  if (!TASK_HOLDER_ROLES.includes(employee.role) || employee.department_id !== departmentId) {
    throw ApiError.badRequest('The selected employee does not belong to this task\'s department.');
  }
  if (employee.status !== 'active') throw ApiError.badRequest('The selected employee is inactive.');
  return employee;
}

function toPublicTask(row) {
  return {
    id: row.task_id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectJobCode: row.project_job_code,
    departmentId: row.department_id,
    departmentName: row.department_name,
    subDepartmentId: row.sub_department_id,
    subDepartmentName: row.sub_department_name,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    taskName: row.task_name,
    ...(featureOn('categories') ? { category: row.category || null } : {}),
    allocatedHours: Number(row.allocated_hours),
    completedHours: Math.round(Number(row.completed_hours || 0) * 10) / 10,
    dueDate: row.due_date,
    status: row.status,
    remarks: row.remarks,
  };
}

// Tells the right people about a reassignment or a status change. Never
// notifies the person who made the change.
async function notifyTaskChanges({ req, task, updated, newOwnerId, status, byAllocator }) {
  const actorId = req.user.id;
  const [[project]] = await pool.query('SELECT name, project_manager_id FROM projects WHERE project_id = ?', [task.project_id]);
  const link = `/projects/${task.project_id}`;
  const label = `"${updated.task_name}" (${project.name})`;

  if (newOwnerId) {
    await notify({
      recipientIds: newOwnerId,
      type: 'task-assigned',
      title: 'A task was assigned to you',
      body: `${label} was reassigned to you.`,
      link: '/my-tasks',
    });
    await notify({
      recipientIds: task.employee_id,
      type: 'task-reassigned',
      title: 'A task was reassigned',
      body: `${label} is now assigned to ${updated.employee_name}. Time you already logged on it is kept.`,
      link: '/my-progress',
    });
  }

  if (!status || status === task.status) return;

  if (byAllocator) {
    // A manager changed it: tell the assignee, unless they were just handed the task.
    if (!newOwnerId && updated.employee_id !== actorId) {
      await notify({
        recipientIds: updated.employee_id,
        type: 'task-status-changed',
        title: `Your task was marked ${status}`,
        body: `${label} was set to ${status} by your manager.`,
        link: '/my-tasks',
      });
    }
    return;
  }

  // The assignee changed it: tell their project manager and Team Leader about holds and completions.
  const remarks = updated.remarks ? ` Note: ${updated.remarks}` : '';
  const lines = await reportingLinesOf(task.employee_id);
  const interested = [project.project_manager_id, lines.teamLeaderId];
  if (status === 'On Hold') {
    await notify({
      recipientIds: interested,
      type: 'task-on-hold',
      severity: 'attention',
      title: 'A task was put on hold',
      body: `${updated.employee_name} put ${label} on hold.${remarks}`,
      link,
    });
  } else if (status === 'Awaiting Input') {
    await notify({
      recipientIds: interested,
      type: 'task-awaiting-input',
      severity: 'attention',
      title: 'A task is waiting on input',
      body: `${updated.employee_name} is waiting on input for ${label}.${remarks}`,
      link,
    });
  } else if (status === 'Completed') {
    await notify({
      recipientIds: interested,
      type: 'task-completed',
      title: 'A task was completed',
      body: `${updated.employee_name} marked ${label} as completed.`,
      link,
    });
  }
}

const listTasksForProject = asyncHandler(async (req, res) => {
  await assertCanViewProject(req.user, req.params.projectId);
  const scope = taskScope(req.user);
  const [rows] = await pool.query(
    `${BASE_SELECT} WHERE t.project_id = ? AND ${scope.sql} GROUP BY t.task_id ORDER BY t.created_at`,
    [req.params.projectId, ...scope.params]
  );
  res.json({ tasks: rows.map(toPublicTask) });
});

const listMyTasks = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`${BASE_SELECT} WHERE t.employee_id = ? GROUP BY t.task_id ORDER BY t.due_date IS NULL, t.due_date`, [req.user.id]);
  res.json({ tasks: rows.map(toPublicTask) });
});

const getTask = asyncHandler(async (req, res) => {
  const scope = taskScope(req.user);
  const [rows] = await pool.query(`${BASE_SELECT} WHERE t.task_id = ? AND ${scope.sql} GROUP BY t.task_id`, [req.params.id, ...scope.params]);
  if (rows[0]) return res.json({ task: toPublicTask(rows[0]) });

  const [exists] = await pool.query('SELECT 1 FROM tasks WHERE task_id = ?', [req.params.id]);
  throw exists.length ? ApiError.forbidden('You cannot view this task.') : ApiError.notFound('Task not found.');
});

// Empty means "no category"; anything else must be one of the SRS categories.
function cleanCategory(value) {
  if (!featureOn('categories')) {
    if (value == null || value === '') return null;
    throw ApiError.badRequest('Task categories are not available yet.');
  }
  if (value == null || value === '') return null;
  if (!TASK_CATEGORIES.includes(value)) throw ApiError.badRequest(`category must be one of: ${TASK_CATEGORIES.join(', ')}.`);
  return value;
}

const listCategories = asyncHandler(async (req, res) => {
  res.json({ categories: featureOn('categories') ? TASK_CATEGORIES : [] });
});

const assignTask = asyncHandler(async (req, res) => {
  const { subDepartmentId, taskName, employeeId, allocatedHours, dueDate, remarks } = req.body;
  const category = cleanCategory(req.body.category);
  const projectId = req.params.projectId;

  if (!subDepartmentId || !taskName || !employeeId || !allocatedHours) {
    throw ApiError.badRequest('subDepartmentId, taskName, employeeId and allocatedHours are required.');
  }
  if (!(Number(allocatedHours) > 0)) throw ApiError.badRequest('allocatedHours must be a positive number.');

  const [projectRows] = await pool.query('SELECT project_id, name FROM projects WHERE project_id = ?', [projectId]);
  if (!projectRows.length) throw ApiError.notFound('Project not found.');

  // The sub-department's parent department must be one of the project's assigned departments.
  const [subDeptRows] = await pool.query(
    `SELECT sd.sub_department_id, sd.department_id FROM sub_departments sd
     JOIN project_departments pd ON pd.department_id = sd.department_id AND pd.project_id = ?
     WHERE sd.sub_department_id = ?`,
    [projectId, subDepartmentId]
  );
  if (!subDeptRows.length) throw ApiError.badRequest('That sub-department is not part of this project\'s departments.');

  // The employee must belong to that same department, and be someone this person may give work to.
  const assignee = await assertAssignableEmployee(employeeId, subDeptRows[0].department_id);
  if (!(await canAllocateTo(req.user, Number(projectId), assignee))) {
    throw ApiError.forbidden('You cannot assign work to this person on this project.');
  }

  const [result] = await pool.query(
    `INSERT INTO tasks (project_id, sub_department_id, employee_id, task_name, category, allocated_hours, due_date, status, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Not Started', ?)`,
    [projectId, subDepartmentId, employeeId, taskName, category, allocatedHours, dueDate || null, remarks || null]
  );

  const [rows] = await pool.query(`${BASE_SELECT} WHERE t.task_id = ? GROUP BY t.task_id`, [result.insertId]);
  await notify({
    recipientIds: employeeId,
    type: 'task-assigned',
    title: 'New task assigned',
    body: `"${taskName}" on ${projectRows[0].name} was assigned to you${dueDate ? `, due ${dueDate}` : ''}.`,
    link: '/my-tasks',
  });

  await record(req.user, {
    action: 'task.assign',
    entityType: 'task',
    entityId: result.insertId,
    summary: `Assigned "${taskName}" (${projectRows[0].name}) to ${rows[0].employee_name}, ${Number(allocatedHours)}h`,
    details: { projectId: Number(projectId), employeeId: Number(employeeId), allocatedHours: Number(allocatedHours), dueDate: dueDate || null },
  });

  res.status(201).json({ task: toPublicTask(rows[0]) });
});

const updateTask = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
  const task = rows[0];
  if (!task) throw ApiError.notFound('Task not found.');

  const [assigneeRows] = await pool.query('SELECT employee_id, department_id, team_id FROM employees WHERE employee_id = ?', [task.employee_id]);
  const isOwner = task.employee_id === req.user.id;
  // Whoever allocates work to this person (their project manager, department
  // head or team leader) may change its scope - but nobody sets the scope of
  // their own work. The person doing the task may change status and remarks.
  const isAllocator = !isOwner && await canAllocateTo(req.user, task.project_id, assigneeRows[0]);
  if (!isOwner && !isAllocator) {
    throw ApiError.forbidden('You cannot change this task.');
  }

  const { status, remarks, allocatedHours, dueDate, taskName, employeeId } = req.body;
  const allowManagerFields = isAllocator;
  const categoryGiven = Object.prototype.hasOwnProperty.call(req.body, 'category');
  const newCategory = categoryGiven ? cleanCategory(req.body.category) : undefined;
  if (categoryGiven && !allowManagerFields) throw ApiError.forbidden('Only the person who allocates this work can change its category.');

  // Reassignment: manager only, to an active employee of the same department.
  // Hours already logged stay on the task (and with whoever logged them).
  let newOwnerId = null;
  if (employeeId != null && Number(employeeId) !== task.employee_id) {
    if (!allowManagerFields) throw ApiError.forbidden('Only the person who allocates this work can reassign it.');
    if (!Number.isInteger(Number(employeeId))) throw ApiError.badRequest('employeeId must be a number.');

    const [subRows] = await pool.query('SELECT department_id FROM sub_departments WHERE sub_department_id = ?', [task.sub_department_id]);
    const newAssignee = await assertAssignableEmployee(Number(employeeId), subRows[0].department_id);
    if (!(await canAllocateTo(req.user, task.project_id, newAssignee))) {
      throw ApiError.forbidden('You cannot assign work to this person on this project.');
    }

    await autoStopStaleSessions(task.employee_id);
    const [running] = await pool.query('SELECT log_id FROM time_logs WHERE task_id = ? AND end_time IS NULL', [req.params.id]);
    if (running.length) {
      throw ApiError.conflict('This task has a running timer. Ask the current assignee to stop it before reassigning.');
    }
    newOwnerId = Number(employeeId);
  }

  if (status && !TASK_STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${TASK_STATUSES.join(', ')}.`);
  }
  if (allocatedHours != null && !(Number(allocatedHours) > 0)) {
    throw ApiError.badRequest('allocatedHours must be a positive number.');
  }
  if (status && status !== 'In Progress' && status !== task.status) {
    const [open] = await pool.query('SELECT log_id FROM time_logs WHERE task_id = ? AND end_time IS NULL', [req.params.id]);
    if (open.length) throw ApiError.conflict('Stop the running timer on this task before changing its status.');
  }

  // When a task finishes, remember when; reopening it clears that.
  const completedAtSql = status === 'Completed' && task.status !== 'Completed' ? 'NOW()'
    : status && status !== 'Completed' && task.status === 'Completed' ? 'NULL' : 'completed_at';

  await pool.query(
    `UPDATE tasks SET
       status = COALESCE(?, status),
       remarks = COALESCE(?, remarks),
       task_name = COALESCE(?, task_name),
       allocated_hours = COALESCE(?, allocated_hours),
       due_date = COALESCE(?, due_date),
       employee_id = COALESCE(?, employee_id),
       category = ${categoryGiven ? '?' : 'category'},
       completed_at = ${completedAtSql}
     WHERE task_id = ?`,
    [
      status || null,
      remarks != null ? remarks : null,
      allowManagerFields ? (taskName || null) : null,
      allowManagerFields ? (allocatedHours || null) : null,
      allowManagerFields ? (dueDate || null) : null,
      newOwnerId,
      ...(categoryGiven ? [newCategory] : []),
      req.params.id,
    ]
  );

  const [updated] = await pool.query(`${BASE_SELECT} WHERE t.task_id = ? GROUP BY t.task_id`, [req.params.id]);
  const diff = changes(task, updated[0], ['task_name', 'category', 'allocated_hours', 'due_date', 'status', 'remarks', 'employee_id']);
  if (Object.keys(diff).length) {
    const only = Object.keys(diff).length === 1 ? Object.keys(diff)[0] : null;
    await record(req.user, {
      action: diff.employee_id ? 'task.reassign' : only === 'status' ? 'task.status' : 'task.update',
      entityType: 'task',
      entityId: task.task_id,
      summary: only === 'status'
        ? `Marked "${updated[0].task_name}" (${updated[0].project_name}) ${updated[0].status}`
        : `Updated "${updated[0].task_name}" (${updated[0].project_name}): ${Object.keys(diff).join(', ')}`,
      details: { ...diff, projectId: task.project_id },
    });
  }
  await notifyTaskChanges({ req, task, updated: updated[0], newOwnerId, status, byAllocator: isAllocator });
  res.json({ task: toPublicTask(updated[0]) });
});

module.exports = { listTasksForProject, listMyTasks, getTask, assignTask, updateTask, listCategories, toPublicTask };
