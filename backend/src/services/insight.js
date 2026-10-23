// The numbers behind the dashboards and the exception screen (SRS §25, §26,
// §30). Everything is computed from tasks and time logs at request time and
// limited to what the caller may see (auth/scope.js).

const pool = require('../config/db');
const { projectScope, taskScope, employeeScope, reviewScope } = require('../auth/scope');
const { TASK_HOLDER_ROLES } = require('../auth/permissions');
const settings = require('./settings');

// Man-hour risk (SRS §26). Hours used against the estimate, and where the
// project is heading if the pace so far continues.
const THRESHOLDS = {
  // Where the estimate turns Amber and Red is a setting the System Administrator can change.
  get amberConsumedPercent() { return settings.get('budgetWarnPercent'); },
  get redConsumedPercent() { return settings.get('budgetCriticalPercent'); },
  amberProjectedPercent: 100, // on course to finish above the estimate
  redProjectedPercent: 115, // on course to finish well above it
  minCompletionForProjection: 10, // too early to project below this
  taskOverrunPercent: 100, // a task past its allocation
  taskCriticalOverrunPercent: 125,
  overdueCriticalDays: 3,
};

const round1 = (n) => Math.round(n * 10) / 10;
const round0 = (n) => Math.round(n);

// Scoped helpers --------------------------------------------------------

const TASK_JOINS = `
  FROM tasks t
  JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
  JOIN departments d ON d.department_id = sd.department_id
  JOIN employees emp ON emp.employee_id = t.employee_id
  JOIN projects p ON p.project_id = t.project_id
`;

// ---------------------------------------------------------------------------
// Project man-hour health (SRS §26)
// ---------------------------------------------------------------------------

function riskFor({ consumedPercent, projectedPercent, overdue }) {
  if (consumedPercent >= THRESHOLDS.redConsumedPercent
    || (projectedPercent != null && projectedPercent >= THRESHOLDS.redProjectedPercent)
    || overdue) return 'RED';
  if (consumedPercent >= THRESHOLDS.amberConsumedPercent
    || (projectedPercent != null && projectedPercent > THRESHOLDS.amberProjectedPercent)) return 'AMBER';
  return 'GREEN';
}

// One row per project the caller can see.
async function projectHealth(user, { includeCompleted = true } = {}) {
  const scope = projectScope(user, 'p');
  const [rows] = await pool.query(
    `SELECT p.project_id, p.job_code, p.name, p.status, p.priority, p.estimated_man_hours, p.target_date, p.completion_override_percent,
            DATEDIFF(CURDATE(), p.target_date) AS days_late, pm.name AS pm_name,
            (SELECT COALESCE(SUM(tl.duration_minutes), 0) / 60 FROM time_logs tl JOIN tasks tt ON tt.task_id = tl.task_id WHERE tt.project_id = p.project_id) AS consumed,
            (SELECT COALESCE(SUM(tt.allocated_hours), 0) FROM tasks tt WHERE tt.project_id = p.project_id) AS allocated,
            (SELECT COALESCE(SUM(tt.allocated_hours), 0) FROM tasks tt WHERE tt.project_id = p.project_id AND tt.status = 'Completed') AS allocated_done,
            (SELECT COUNT(*) FROM tasks tt WHERE tt.project_id = p.project_id) AS task_count,
            (SELECT COUNT(*) FROM tasks tt WHERE tt.project_id = p.project_id AND tt.status = 'Completed') AS tasks_done,
            (SELECT GROUP_CONCAT(dd.name ORDER BY dd.name SEPARATOR ', ')
               FROM project_departments pd JOIN departments dd ON dd.department_id = pd.department_id
              WHERE pd.project_id = p.project_id) AS departments_list
       FROM projects p
       JOIN employees pm ON pm.employee_id = p.project_manager_id
      WHERE ${scope.sql}${includeCompleted ? '' : " AND p.status <> 'Completed'"}
      ORDER BY p.status = 'Completed', p.created_at DESC`,
    scope.params
  );

  return rows.map((r) => {
    const estimate = Number(r.estimated_man_hours);
    const consumed = Number(r.consumed);
    const allocated = Number(r.allocated);
    const done = Number(r.allocated_done);
    // Progress is the share of allocated work that is finished.
    const manualCompletion = r.completion_override_percent != null;
    const completionPercent = manualCompletion ? Number(r.completion_override_percent) : allocated > 0 ? (done / allocated) * 100 : 0;
    const consumedPercent = estimate > 0 ? (consumed / estimate) * 100 : 0;
    const projectedFinal = completionPercent >= THRESHOLDS.minCompletionForProjection && r.status !== 'Completed'
      ? consumed / (completionPercent / 100)
      : null;
    const projectedPercent = projectedFinal != null && estimate > 0 ? (projectedFinal / estimate) * 100 : null;
    const overdue = r.status !== 'Completed' && r.target_date != null && Number(r.days_late) > 0;
    return {
      id: r.project_id,
      jobCode: r.job_code,
      name: r.name,
      status: r.status,
      priority: r.priority,
      projectManagerName: r.pm_name,
      departments: r.departments_list ? r.departments_list.split(', ') : [],
      targetDate: r.target_date,
      estimatedManHours: round1(estimate),
      consumedManHours: round1(consumed),
      remainingManHours: round1(Math.max(0, estimate - consumed)),
      consumedPercent: round0(consumedPercent),
      allocatedManHours: round1(allocated),
      taskCount: Number(r.task_count),
      tasksCompleted: Number(r.tasks_done),
      completionPercent: round0(completionPercent),
      completionIsManual: manualCompletion,
      projectedFinalManHours: projectedFinal != null ? round1(projectedFinal) : null,
      overdue,
      risk: r.status === 'Completed' ? 'GREEN' : riskFor({ consumedPercent, projectedPercent, overdue }),
    };
  });
}

// The man-hour breakdown of one project (SRS §26): hours by person, by
// sub-discipline (task type) and by department, limited to the tasks the
// caller may see. Hours belong to whoever logged them.
async function projectManHours(user, projectId) {
  const health = (await projectHealth(user)).find((p) => p.id === Number(projectId));
  if (!health) return null;
  const ts = taskScope(user);
  const hoursBy = async (key, label) => {
    const [rows] = await pool.query(
      `SELECT ${key} AS id, ${label} AS name, COALESCE(SUM(tl.duration_minutes), 0) / 60 AS hours
         FROM time_logs tl
         JOIN tasks t ON t.task_id = tl.task_id
         JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
         JOIN departments d ON d.department_id = sd.department_id
         JOIN employees emp ON emp.employee_id = t.employee_id
         JOIN employees lg ON lg.employee_id = tl.employee_id
         JOIN projects p ON p.project_id = t.project_id
        WHERE t.project_id = ? AND ${ts.sql}
        GROUP BY ${key}, ${label}
        ORDER BY hours DESC, name`,
      [projectId, ...ts.params]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, hours: round1(Number(r.hours)) }));
  };
  return {
    ...health,
    byEmployee: await hoursBy('lg.employee_id', 'lg.name'),
    byTaskType: await hoursBy('sd.sub_department_id', 'sd.name'),
    byDepartment: await hoursBy('d.department_id', 'd.name'),
    byCategory: await hoursBy("COALESCE(t.category, 'Uncategorised')", "COALESCE(t.category, 'Uncategorised')"),
  };
}

// ---------------------------------------------------------------------------
// Exceptions (SRS §30, project-related only)
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, attention: 1 };

async function exceptionsFor(user) {
  const items = [];
  const push = (item) => items.push(item);

  // Task level: overdue, waiting, on hold, over their allocation.
  const ts = taskScope(user);
  const [tasks] = await pool.query(
    `SELECT t.task_id, t.task_name, t.status, t.allocated_hours, t.due_date,
            DATEDIFF(CURDATE(), t.due_date) AS days_late,
            p.project_id, p.name AS project_name, emp.employee_id, emp.name AS employee_name,
            (SELECT COALESCE(SUM(tl.duration_minutes), 0) / 60 FROM time_logs tl WHERE tl.task_id = t.task_id) AS spent
       ${TASK_JOINS}
      WHERE p.status <> 'Completed' AND ${ts.sql}`,
    ts.params
  );
  for (const t of tasks) {
    const base = { projectId: t.project_id, projectName: t.project_name, taskId: t.task_id, employeeId: t.employee_id, employeeName: t.employee_name };
    const label = `"${t.task_name}" — ${t.employee_name}`;
    const open = t.status !== 'Completed';
    if (open && t.due_date && Number(t.days_late) > 0) {
      const days = Number(t.days_late);
      push({
        ...base, type: 'task-overdue', category: 'Overdue task',
        severity: days > THRESHOLDS.overdueCriticalDays ? 'critical' : 'attention',
        title: `Overdue by ${days} day${days === 1 ? '' : 's'}`, detail: label, days,
      });
    }
    if (t.status === 'Awaiting Input') {
      push({ ...base, type: 'task-awaiting-input', category: 'Awaiting input', severity: 'attention', title: 'Waiting on input', detail: label });
    }
    if (t.status === 'On Hold') {
      push({ ...base, type: 'task-on-hold', category: 'On hold', severity: 'attention', title: 'Task on hold', detail: label });
    }
    const allocated = Number(t.allocated_hours);
    const spent = Number(t.spent);
    if (open && allocated > 0 && (spent / allocated) * 100 > THRESHOLDS.taskOverrunPercent) {
      const percent = round0((spent / allocated) * 100);
      push({
        ...base, type: 'task-over-allocation', category: 'Over allocation',
        severity: percent > THRESHOLDS.taskCriticalOverrunPercent ? 'critical' : 'attention',
        title: `Used ${round1(spent)}h of ${round1(allocated)}h allocated (${percent}%)`, detail: label,
      });
    }
  }

  // Project level: budget and target date.
  for (const p of await projectHealth(user, { includeCompleted: false })) {
    const base = { projectId: p.id, projectName: p.name };
    const figures = `${p.consumedManHours}h of ${p.estimatedManHours}h`;
    if (p.consumedPercent >= THRESHOLDS.redConsumedPercent) {
      push({ ...base, type: 'budget-exceeded', category: 'Man-hours', severity: 'critical', title: 'Estimated man-hours used up', detail: `${p.name}: ${figures} (${p.consumedPercent}%)` });
    } else if (p.consumedPercent >= THRESHOLDS.amberConsumedPercent) {
      push({ ...base, type: 'budget-warning', category: 'Man-hours', severity: 'attention', title: 'Nearing the estimated man-hours', detail: `${p.name}: ${figures} (${p.consumedPercent}%)` });
    } else if (p.risk !== 'GREEN' && p.projectedFinalManHours != null && !p.overdue) {
      push({ ...base, type: 'projected-overrun', category: 'Man-hours', severity: 'attention', title: 'On course to exceed the estimate', detail: `${p.name}: projected ${p.projectedFinalManHours}h against ${p.estimatedManHours}h` });
    }
    if (p.overdue) {
      push({ ...base, type: 'project-overdue', category: 'Schedule', severity: 'critical', title: 'Past its target date', detail: `${p.name} was due ${String(p.targetDate).slice(0, 10)}` });
    }
  }

  // People with nothing allocated (SRS §29). Only for the roles that look after
  // people: a Team Leader, a Department Head, Management.
  if (DASHBOARD_KIND[user.role]) {
    const ps = employeeScope(user, 'emp');
    const [idle] = await pool.query(
      `SELECT emp.employee_id, emp.name, emp.designation
         FROM employees emp
        WHERE emp.status = 'active' AND emp.role IN (?) AND ${ps.sql}
          AND NOT EXISTS (SELECT 1 FROM tasks t JOIN projects p ON p.project_id = t.project_id
                           WHERE t.employee_id = emp.employee_id AND t.status <> 'Completed' AND p.status <> 'Completed')
        ORDER BY emp.name`,
      [TASK_HOLDER_ROLES, ...ps.params]
    );
    for (const e of idle) {
      push({
        projectId: null, projectName: '', taskId: null, employeeId: e.employee_id, employeeName: e.name,
        type: 'no-allocation', category: 'No allocation', severity: 'attention',
        title: 'No project allocation', detail: `${e.name}${e.designation ? ` — ${e.designation}` : ''} has no open work`,
      });
    }
  }

  // Time awaiting review.
  const rs = reviewScope(user, 'e', 'p');
  if (rs.sql !== '1 = 0') {
    const [flagged] = await pool.query(
      `SELECT tl.log_id, t.task_id, t.task_name, p.project_id, p.name AS project_name, e.employee_id, e.name AS employee_name
         FROM time_logs tl
         JOIN tasks t ON t.task_id = tl.task_id
         JOIN projects p ON p.project_id = t.project_id
         JOIN employees e ON e.employee_id = tl.employee_id
        WHERE tl.auto_stopped = 1 AND tl.edited_at IS NULL AND ${rs.sql}`,
      rs.params
    );
    for (const f of flagged) {
      push({
        projectId: f.project_id, projectName: f.project_name, taskId: f.task_id, employeeId: f.employee_id, employeeName: f.employee_name,
        type: 'session-review', category: 'Time review', severity: 'attention',
        title: 'Auto-stopped session needs review', detail: `"${f.task_name}" — ${f.employee_name}`,
      });
    }
  }

  items.forEach((item, i) => { item.key = `${item.type}:${item.taskId || item.projectId || item.employeeId}:${i}`; });
  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.projectName || '').localeCompare(b.projectName || ''));
  return items;
}

// ---------------------------------------------------------------------------
// Dashboards (SRS §25 team, department, company)
// ---------------------------------------------------------------------------

const DASHBOARD_KIND = { team_leader: 'team', department_head: 'department', management: 'company' };

async function scopeLabel(user, kind) {
  if (kind === 'company') return 'Whole company';
  if (kind === 'department') {
    if (!user.scopeDepartmentIds.length) return 'No department assigned';
    const [rows] = await pool.query('SELECT name FROM departments WHERE department_id IN (?) ORDER BY name', [user.scopeDepartmentIds]);
    return rows.map((r) => r.name).join(', ');
  }
  if (!user.teamIds.length) return 'No team assigned';
  const [rows] = await pool.query('SELECT name FROM teams WHERE team_id IN (?) ORDER BY name', [user.teamIds]);
  return rows.map((r) => r.name).join(', ');
}

async function dashboardFor(user) {
  const kind = DASHBOARD_KIND[user.role];
  const ts = taskScope(user);
  const ps = employeeScope(user, 'emp');

  // Task status mix, overdue count.
  const [statusRows] = await pool.query(
    `SELECT t.status, COUNT(*) AS n,
            SUM(t.status <> 'Completed' AND t.due_date IS NOT NULL AND t.due_date < CURDATE()) AS overdue
       ${TASK_JOINS}
      WHERE ${ts.sql}
      GROUP BY t.status`,
    ts.params
  );
  const statusCounts = {};
  let overdueTasks = 0;
  for (const r of statusRows) { statusCounts[r.status] = Number(r.n); overdueTasks += Number(r.overdue); }
  const openTasks = Object.entries(statusCounts).filter(([s]) => s !== 'Completed').reduce((sum, [, n]) => sum + n, 0);

  // People: one row per active task holder in scope.
  const [people] = await pool.query(
    `SELECT emp.employee_id, emp.name, emp.designation, emp.role, d.name AS department_name, tm.name AS team_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = emp.employee_id AND t.status <> 'Completed') AS open_tasks,
            (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = emp.employee_id AND t.status <> 'Completed'
                AND t.due_date IS NOT NULL AND t.due_date < CURDATE()) AS overdue_tasks,
            (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = emp.employee_id AND t.status IN ('Awaiting Input','On Hold')) AS blocked_tasks,
            (SELECT COALESCE(SUM(tl.duration_minutes), 0) / 60 FROM time_logs tl WHERE tl.employee_id = emp.employee_id AND tl.log_date = CURDATE()) AS hours_today,
            (SELECT COALESCE(SUM(tl.duration_minutes), 0) / 60 FROM time_logs tl WHERE tl.employee_id = emp.employee_id
                AND YEARWEEK(tl.log_date, 1) = YEARWEEK(CURDATE(), 1)) AS hours_week,
            (SELECT t.task_name FROM time_logs tl JOIN tasks t ON t.task_id = tl.task_id
              WHERE tl.employee_id = emp.employee_id AND tl.end_time IS NULL LIMIT 1) AS running_task
       FROM employees emp
       LEFT JOIN departments d ON d.department_id = emp.department_id
       LEFT JOIN teams tm ON tm.team_id = emp.team_id
      WHERE emp.status = 'active' AND emp.role IN (?) AND ${ps.sql}
      ORDER BY emp.name`,
    [TASK_HOLDER_ROLES, ...ps.params]
  );

  const peopleRows = people.map((r) => ({
    id: r.employee_id,
    name: r.name,
    designation: r.designation,
    department: r.department_name,
    team: r.team_name,
    isTeamLeader: r.role === 'team_leader',
    openTasks: Number(r.open_tasks),
    overdueTasks: Number(r.overdue_tasks),
    blockedTasks: Number(r.blocked_tasks),
    hoursToday: round1(Number(r.hours_today)),
    hoursWeek: round1(Number(r.hours_week)),
    runningTask: r.running_task || null,
  }));

  // Budgeted versus actual hours on the open work in scope (SRS §25).
  const [[hours]] = await pool.query(
    `SELECT COALESCE(SUM(t.allocated_hours), 0) AS allocated,
            COALESCE(SUM((SELECT SUM(tl.duration_minutes) / 60 FROM time_logs tl WHERE tl.task_id = t.task_id)), 0) AS logged
       ${TASK_JOINS}
      WHERE t.status <> 'Completed' AND p.status <> 'Completed' AND ${ts.sql}`,
    ts.params
  );

  const projects = await projectHealth(user, { includeCompleted: false });
  const exceptions = await exceptionsFor(user);

  return {
    kind,
    scopeLabel: await scopeLabel(user, kind),
    stats: {
      people: peopleRows.length,
      withoutAllocation: peopleRows.filter((p) => p.openTasks === 0).length,
      allocatedHours: round1(Number(hours.allocated)),
      loggedHours: round1(Number(hours.logged)),
      openTasks,
      overdueTasks,
      awaitingInput: statusCounts['Awaiting Input'] || 0,
      onHold: statusCounts['On Hold'] || 0,
      runningNow: peopleRows.filter((p) => p.runningTask).length,
      hoursToday: round1(peopleRows.reduce((s, p) => s + p.hoursToday, 0)),
      hoursWeek: round1(peopleRows.reduce((s, p) => s + p.hoursWeek, 0)),
      activeProjects: projects.length,
      atRiskProjects: projects.filter((p) => p.risk !== 'GREEN').length,
      exceptions: exceptions.length,
      criticalExceptions: exceptions.filter((e) => e.severity === 'critical').length,
    },
    statusCounts,
    people: peopleRows,
    projects,
    exceptions: exceptions.slice(0, 8),
  };
}

module.exports = { THRESHOLDS, DASHBOARD_KIND, riskFor, projectHealth, projectManHours, exceptionsFor, dashboardFor };
