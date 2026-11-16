const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { projectScope, taskScope, assertCanViewProject, canManageProject, assertCanManageProject, filterAllocatable } = require('../auth/scope');
const { ROLES, PROJECT_MANAGER_ROLES, TASK_HOLDER_ROLES } = require('../auth/permissions');
const { notify, checkProjectBudget } = require('../services/notifications');
const { featureOn, isRoleEnabled } = require('../config/rollout');
const { projectHealth } = require('../services/insight');
const { record, changes } = require('../services/audit');

const PROJECT_STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

// The agreed fee is commercial information: only the people who run projects,
// and Management, see it.
const COMMERCIAL_ROLES = [ROLES.PROJECT_MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.MANAGEMENT];
const canSeeCommercial = (user) => Boolean(user) && COMMERCIAL_ROLES.includes(user.role);

function toPublicProject(row, user) {
  return {
    ...(featureOn('projectExtras') ? {
      ...(canSeeCommercial(user) ? { agreedFee: row.agreed_fee != null ? Number(row.agreed_fee) : null } : {}),
      teamLeaderId: row.team_leader_id ?? null,
      teamLeaderName: row.tl_name || null,
      completionOverridePercent: row.completion_override_percent ?? null,
    } : {}),
    id: row.project_id,
    jobCode: row.job_code,
    name: row.name,
    clientName: row.client_name,
    consultantName: row.consultant_name,
    mainContractorName: row.main_contractor_name,
    mapContractorName: row.map_contractor_name,
    projectManagerId: row.project_manager_id,
    projectManagerName: row.pm_name,
    startDate: row.start_date,
    targetDate: row.target_date,
    actualCompletionDate: row.actual_completion_date,
    priority: row.priority,
    estimatedManHours: Number(row.estimated_man_hours),
    completedManHours: Math.round(Number(row.completed_hours || 0) * 10) / 10,
    status: row.status,
    taskCount: row.task_count != null ? Number(row.task_count) : undefined,
  };
}

const BASE_SELECT = `
  SELECT p.*, e.name AS pm_name, tlead.name AS tl_name,
         COALESCE(SUM(tl.duration_minutes), 0) / 60 AS completed_hours,
         COUNT(DISTINCT t.task_id) AS task_count
  FROM projects p
  JOIN employees e ON e.employee_id = p.project_manager_id
  LEFT JOIN employees tlead ON tlead.employee_id = p.team_leader_id
  LEFT JOIN tasks t ON t.project_id = p.project_id
  LEFT JOIN time_logs tl ON tl.task_id = t.task_id
`;

// Only active managers (Project Managers and Department Heads) can be named
// the manager of a project.
const openManagerRoles = () => PROJECT_MANAGER_ROLES.filter(isRoleEnabled);

async function assertEligibleProjectManager(projectManagerId) {
  const [pm] = await pool.query(
    'SELECT employee_id FROM employees WHERE employee_id = ? AND role IN (?) AND status = ?',
    [projectManagerId, openManagerRoles(), 'active']
  );
  if (!pm.length) throw ApiError.badRequest('projectManagerId must reference an active Project Manager or Department Head.');
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// The optional master-data fields: team leader, agreed fee and a manager's own
// completion figure. Each may be sent as null to clear it. Returns the columns
// to set; throws a 400 for a value that cannot be stored.
async function readMasterFields(body) {
  const out = {};
  if (!featureOn('projectExtras')) {
    if (['teamLeaderId', 'agreedFee', 'completionOverridePercent'].some((key) => has(body, key))) {
      throw ApiError.badRequest('Those project fields are not available yet.');
    }
    return out;
  }
  if (has(body, 'teamLeaderId')) {
    if (body.teamLeaderId === null || body.teamLeaderId === '') {
      out.team_leader_id = null;
    } else {
      const [tl] = await pool.query("SELECT employee_id FROM employees WHERE employee_id = ? AND role = 'team_leader' AND status = 'active'", [body.teamLeaderId]);
      if (!tl.length) throw ApiError.badRequest('teamLeaderId must be an active Team Leader.');
      out.team_leader_id = Number(body.teamLeaderId);
    }
  }
  if (has(body, 'agreedFee')) {
    if (body.agreedFee === null || body.agreedFee === '') {
      out.agreed_fee = null;
    } else {
      const fee = Number(body.agreedFee);
      if (!Number.isFinite(fee) || fee < 0 || fee > 1e12) throw ApiError.badRequest('agreedFee must be zero or a positive amount.');
      out.agreed_fee = fee;
    }
  }
  if (has(body, 'completionOverridePercent')) {
    if (body.completionOverridePercent === null || body.completionOverridePercent === '') {
      out.completion_override_percent = null;
    } else {
      const pct = Number(body.completionOverridePercent);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw ApiError.badRequest('completionOverridePercent must be a whole number from 0 to 100.');
      out.completion_override_percent = pct;
    }
  }
  return out;
}

async function applyMasterFields(conn, projectId, fields) {
  const columns = Object.keys(fields);
  if (!columns.length) return;
  await conn.query(`UPDATE projects SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE project_id = ?`, [...columns.map((c) => fields[c]), projectId]);
}

const listProjects = asyncHandler(async (req, res) => {
  const scope = projectScope(req.user, 'p');
  const [rows] = await pool.query(
    `${BASE_SELECT} WHERE ${scope.sql} GROUP BY p.project_id ORDER BY p.created_at DESC`,
    scope.params
  );
  res.json({ projects: rows.map((r) => toPublicProject(r, req.user)) });
});

async function projectDetail(projectId, user) {
  const [rows] = await pool.query(`${BASE_SELECT} WHERE p.project_id = ? GROUP BY p.project_id`, [projectId]);
  if (!rows[0]) return null;

  const [deptRows] = await pool.query(
    `SELECT d.department_id, d.name FROM project_departments pd
     JOIN departments d ON d.department_id = pd.department_id
     WHERE pd.project_id = ? ORDER BY d.name`,
    [projectId]
  );
  // Who has been given work on the project, with planned and used hours (only
  // the tasks the viewer may see).
  const ts = taskScope(user);
  const [people] = await pool.query(
    `SELECT emp.employee_id, emp.name, emp.designation, COUNT(*) AS tasks, SUM(t.allocated_hours) AS planned,
            (SELECT COALESCE(SUM(l.duration_minutes), 0) / 60 FROM time_logs l JOIN tasks tt ON tt.task_id = l.task_id
              WHERE tt.project_id = ? AND l.employee_id = emp.employee_id) AS consumed
       FROM tasks t
       JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
       JOIN departments d ON d.department_id = sd.department_id
       JOIN employees emp ON emp.employee_id = t.employee_id
       JOIN projects p ON p.project_id = t.project_id
      WHERE t.project_id = ? AND ${ts.sql}
      GROUP BY emp.employee_id, emp.name, emp.designation
      ORDER BY emp.name`,
    [projectId, projectId, ...ts.params]
  );
  const health = (await projectHealth(user)).find((h) => h.id === Number(projectId));
  return {
    ...toPublicProject(rows[0], user),
    ...(health && featureOn('manHours') ? {
      completionPercent: health.completionPercent,
      completionIsManual: health.completionIsManual,
      projectedFinalManHours: health.projectedFinalManHours,
      risk: health.risk,
    } : {}),
    departments: deptRows.map((d) => ({ id: d.department_id, name: d.name })),
    assignedEmployees: people.map((r) => ({
      id: r.employee_id,
      name: r.name,
      designation: r.designation,
      taskCount: Number(r.tasks),
      plannedHours: Math.round(Number(r.planned) * 10) / 10,
      consumedHours: Math.round(Number(r.consumed) * 10) / 10,
    })),
  };
}

const getProject = asyncHandler(async (req, res) => {
  const project = await projectDetail(req.params.id, req.user);
  if (!project) throw ApiError.notFound('Project not found.');
  await assertCanViewProject(req.user, req.params.id);

  const edit = await canManageProject(req.user, req.params.id);
  res.json({
    project: {
      ...project,
      // What the signed-in person may do with this project, so screens show the right buttons.
      permissions: { edit, allocate: edit || req.user.role === ROLES.TEAM_LEADER },
    },
  });
});

const createProject = asyncHandler(async (req, res) => {
  const {
    name, jobCode, clientName, consultantName, mainContractorName, mapContractorName,
    projectManagerId, departmentIds, startDate, targetDate, priority, estimatedManHours,
  } = req.body;

  if (!name || !jobCode || !clientName || !estimatedManHours || !Array.isArray(departmentIds) || departmentIds.length === 0) {
    throw ApiError.badRequest('name, jobCode, clientName, estimatedManHours and at least one departmentId are required.');
  }
  if (!(Number(estimatedManHours) > 0)) throw ApiError.badRequest('estimatedManHours must be a positive number.');

  const [existing] = await pool.query('SELECT project_id FROM projects WHERE job_code = ?', [jobCode]);
  if (existing.length) throw ApiError.conflict(`Job code "${jobCode}" is already in use.`);

  const uniqueDepartmentIds = [...new Set(departmentIds.map(Number))];
  if (uniqueDepartmentIds.some((n) => !Number.isInteger(n) || n <= 0)) throw ApiError.badRequest('departmentIds must be department IDs.');
  const [foundDepartments] = await pool.query('SELECT department_id FROM departments WHERE department_id IN (?)', [uniqueDepartmentIds]);
  if (foundDepartments.length !== uniqueDepartmentIds.length) throw ApiError.badRequest('One or more departments do not exist.');

  const pmId = projectManagerId || req.user.id;
  await assertEligibleProjectManager(pmId);
  const masterFields = await readMasterFields(req.body);

  if (req.user.role === ROLES.DEPARTMENT_HEAD) {
    const mine = req.user.scopeDepartmentIds || [];
    if (!departmentIds.some((id) => mine.includes(Number(id)))) {
      throw ApiError.badRequest('A new project must include at least one of your own departments.');
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO projects
        (job_code, name, client_name, consultant_name, main_contractor_name, map_contractor_name,
         project_manager_id, start_date, target_date, priority, estimated_man_hours, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Planning')`,
      [jobCode, name, clientName, consultantName || null, mainContractorName || null, mapContractorName || null,
        pmId, startDate || null, targetDate || null, priority || 'Medium', estimatedManHours]
    );
    const projectId = result.insertId;
    await applyMasterFields(conn, projectId, masterFields);

    for (const deptId of uniqueDepartmentIds) {
      await conn.query('INSERT INTO project_departments (project_id, department_id) VALUES (?, ?)', [projectId, deptId]);
    }

    await conn.commit();

    await record(req.user, {
      action: 'project.create',
      entityType: 'project',
      entityId: projectId,
      summary: `Created project ${name} (${jobCode})`,
      details: { jobCode, projectManagerId: Number(pmId), departmentIds: departmentIds.map(Number), estimatedManHours: Number(estimatedManHours) },
    });

    const [rows] = await pool.query(`${BASE_SELECT} WHERE p.project_id = ? GROUP BY p.project_id`, [projectId]);
    if (Number(pmId) !== req.user.id) {
      await notify({
        recipientIds: pmId,
        type: 'project-assigned',
        title: 'You were made project manager',
        body: `${name} (${jobCode}) was created with you as project manager.`,
        link: `/projects/${projectId}`,
      });
    }
    res.status(201).json({ project: toPublicProject(rows[0], req.user) });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

const updateProject = asyncHandler(async (req, res) => {
  const [existing] = await pool.query('SELECT * FROM projects WHERE project_id = ?', [req.params.id]);
  if (!existing.length) throw ApiError.notFound('Project not found.');
  await assertCanManageProject(req.user, req.params.id);

  const {
    name, clientName, consultantName, mainContractorName, mapContractorName,
    startDate, targetDate, actualCompletionDate, priority, estimatedManHours, status,
    projectManagerId, departmentIds,
  } = req.body;

  if (status && !PROJECT_STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${PROJECT_STATUSES.join(', ')}.`);
  }
  if (priority && !PRIORITIES.includes(priority)) {
    throw ApiError.badRequest(`priority must be one of: ${PRIORITIES.join(', ')}.`);
  }
  if (estimatedManHours != null && !(Number(estimatedManHours) > 0)) {
    throw ApiError.badRequest('estimatedManHours must be a positive number.');
  }

  if (projectManagerId != null) await assertEligibleProjectManager(projectManagerId);
  const masterFields = await readMasterFields(req.body);

  // Departments: replace the project's set, but never drop one that already has tasks.
  let newDepartmentIds = null;
  if (departmentIds !== undefined) {
    if (!Array.isArray(departmentIds) || departmentIds.length === 0) {
      throw ApiError.badRequest('departmentIds must be a list with at least one department.');
    }
    newDepartmentIds = [...new Set(departmentIds.map(Number))];
    if (newDepartmentIds.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw ApiError.badRequest('departmentIds must be department IDs.');
    }
    const [found] = await pool.query('SELECT department_id FROM departments WHERE department_id IN (?)', [newDepartmentIds]);
    if (found.length !== newDepartmentIds.length) throw ApiError.badRequest('One or more departments do not exist.');

    const [inUse] = await pool.query(
      `SELECT DISTINCT d.name FROM tasks t
         JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
         JOIN departments d ON d.department_id = sd.department_id
        WHERE t.project_id = ? AND d.department_id NOT IN (?)
        ORDER BY d.name`,
      [req.params.id, newDepartmentIds]
    );
    if (inUse.length) {
      throw ApiError.conflict(`Cannot remove ${inUse.map((d) => d.name).join(', ')}: the project already has tasks in ${inUse.length === 1 ? 'it' : 'them'}.`);
    }
  }

  const [departmentsBefore] = await pool.query('SELECT department_id FROM project_departments WHERE project_id = ? ORDER BY department_id', [req.params.id]);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
    `UPDATE projects SET
       name = COALESCE(?, name),
       client_name = COALESCE(?, client_name),
       consultant_name = COALESCE(?, consultant_name),
       main_contractor_name = COALESCE(?, main_contractor_name),
       map_contractor_name = COALESCE(?, map_contractor_name),
       start_date = COALESCE(?, start_date),
       target_date = COALESCE(?, target_date),
       actual_completion_date = COALESCE(?, actual_completion_date),
       priority = COALESCE(?, priority),
       estimated_man_hours = COALESCE(?, estimated_man_hours),
       status = COALESCE(?, status),
       project_manager_id = COALESCE(?, project_manager_id)
     WHERE project_id = ?`,
    [name || null, clientName || null, consultantName || null, mainContractorName || null, mapContractorName || null,
      startDate || null, targetDate || null, actualCompletionDate || null, priority || null,
      estimatedManHours || null, status || null, projectManagerId || null, req.params.id]
    );

    await applyMasterFields(conn, req.params.id, masterFields);

    if (newDepartmentIds) {
      await conn.query('DELETE FROM project_departments WHERE project_id = ? AND department_id NOT IN (?)', [req.params.id, newDepartmentIds]);
      for (const deptId of newDepartmentIds) {
        await conn.query('INSERT IGNORE INTO project_departments (project_id, department_id) VALUES (?, ?)', [req.params.id, deptId]);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [[updatedRow]] = await pool.query('SELECT * FROM projects WHERE project_id = ?', [req.params.id]);
  const diff = changes(existing[0], updatedRow, [
    'name', 'client_name', 'consultant_name', 'main_contractor_name', 'map_contractor_name', 'start_date', 'target_date',
    'actual_completion_date', 'priority', 'estimated_man_hours', 'status', 'project_manager_id',
    'team_leader_id', 'agreed_fee', 'completion_override_percent',
  ]);
  if (newDepartmentIds) {
    const before = departmentsBefore.map((d) => d.department_id);
    const after = [...newDepartmentIds].sort((a, b) => a - b);
    if (before.join() !== after.join()) diff.departments = { from: before.join(','), to: after.join(',') };
  }
  if (Object.keys(diff).length) {
    await record(req.user, {
      action: diff.project_manager_id ? 'project.manager-change' : 'project.update',
      entityType: 'project',
      entityId: Number(req.params.id),
      summary: `Updated project ${updatedRow.name}: ${Object.keys(diff).join(', ')}`,
      details: diff,
    });
  }

  const previousManagerId = existing[0].project_manager_id;
  if (projectManagerId != null && Number(projectManagerId) !== previousManagerId) {
    const projectName = name || existing[0].name;
    await notify({
      recipientIds: projectManagerId,
      type: 'project-assigned',
      title: 'You were made project manager',
      body: `You are now the project manager of ${projectName}.`,
      link: `/projects/${req.params.id}`,
    });
    await notify({
      recipientIds: previousManagerId,
      type: 'project-manager-changed',
      title: 'Project manager changed',
      body: `You are no longer the project manager of ${projectName}.`,
      link: `/projects/${req.params.id}`,
    });
  }
  if (estimatedManHours != null || status) await checkProjectBudget(req.params.id);

  res.json({ project: await projectDetail(req.params.id, req.user) });
});

// Who the signed-in person may give work to on this project, for the
// "assign task" form. The server applies the same rules as assigning does.
const listAssignees = asyncHandler(async (req, res) => {
  const [project] = await pool.query('SELECT project_id FROM projects WHERE project_id = ?', [req.params.projectId]);
  if (!project.length) throw ApiError.notFound('Project not found.');
  await assertCanViewProject(req.user, req.params.projectId);

  const [candidates] = await pool.query(
    `SELECT e.employee_id, e.name, e.designation, e.department_id, e.team_id, d.name AS department_name
       FROM employees e
       JOIN departments d ON d.department_id = e.department_id
      WHERE e.status = 'active' AND e.role IN (?)
        AND e.department_id IN (SELECT pd.department_id FROM project_departments pd WHERE pd.project_id = ?)
      ORDER BY d.name, e.name`,
    [TASK_HOLDER_ROLES, req.params.projectId]
  );
  const allowed = await filterAllocatable(req.user, Number(req.params.projectId), candidates);
  res.json({
    assignees: allowed.map((e) => ({
      id: e.employee_id, name: e.name, designation: e.designation,
      departmentId: e.department_id, department: e.department_name, teamId: e.team_id,
    })),
  });
});

// Active people who can be named the manager of a project.
const listProjectManagers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT employee_id, name, role FROM employees WHERE role IN (?) AND status = 'active' ORDER BY name",
    [openManagerRoles()]
  );
  res.json({ managers: rows.map((r) => ({ id: r.employee_id, name: r.name, role: r.role })) });
});

// Active Team Leaders, for naming one on a project.
const listTeamLeaders = asyncHandler(async (req, res) => {
  if (!featureOn('projectExtras')) return res.json({ teamLeaders: [] });
  const [rows] = await pool.query(
    `SELECT e.employee_id, e.name, d.name AS department_name FROM employees e
       LEFT JOIN departments d ON d.department_id = e.department_id
      WHERE e.role = 'team_leader' AND e.status = 'active' ORDER BY d.name, e.name`
  );
  res.json({ teamLeaders: rows.map((r) => ({ id: r.employee_id, name: r.name, department: r.department_name || null })) });
});

module.exports = { listProjects, getProject, createProject, updateProject, listAssignees, listProjectManagers, listTeamLeaders, toPublicProject };
