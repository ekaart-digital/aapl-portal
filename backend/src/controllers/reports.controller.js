const pool = require('../config/db');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const { toPublicProject } = require('./projects.controller');
const { autoStopStaleSessions } = require('../services/timerSweep');
const { projectScope, employeeScope, taskScope, ALLOW } = require('../auth/scope');
const { projectHealth, exceptionsFor, DASHBOARD_KIND } = require('../services/insight');
const { periodRange } = require('../services/periods');
const { TASK_HOLDER_ROLES, can } = require('../auth/permissions');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const projectDetailsReport = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  const scope = projectScope(req.user, 'p');
  const [rows] = await pool.query(`
    SELECT p.*, e.name AS pm_name,
           COALESCE(SUM(tl.duration_minutes), 0) / 60 AS completed_hours,
           COUNT(DISTINCT t.task_id) AS task_count,
           (SELECT GROUP_CONCAT(d.name ORDER BY d.name SEPARATOR ', ')
              FROM project_departments pd JOIN departments d ON d.department_id = pd.department_id
             WHERE pd.project_id = p.project_id) AS departments_list
    FROM projects p
    JOIN employees e ON e.employee_id = p.project_manager_id
    LEFT JOIN tasks t ON t.project_id = p.project_id
    LEFT JOIN time_logs tl ON tl.task_id = t.task_id
    WHERE ${scope.sql}
    GROUP BY p.project_id
    ORDER BY p.created_at DESC
  `, scope.params);
  res.json({
    projects: rows.map((r) => ({
      ...toPublicProject(r),
      departments: r.departments_list ? r.departments_list.split(', ') : [],
    })),
  });
});

const employeeWorkTimeReport = asyncHandler(async (req, res) => {
  const { from, to, projectId, departmentId, teamId } = req.query; // all optional
  await autoStopStaleSessions();
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    throw ApiError.badRequest('from and to must be dates in YYYY-MM-DD format.');
  }

  for (const [name, value] of [['projectId', projectId], ['departmentId', departmentId], ['teamId', teamId]]) {
    if (value && !/^\d+$/.test(String(value))) throw ApiError.badRequest(`${name} must be a number.`);
  }

  // Hours belong to whoever logged them, even if the task has since been
  // reassigned; task counts are the tasks currently assigned. Only work on
  // projects the viewer is allowed to see is counted.
  const projScope = projectScope(req.user, 'rp');
  const visibleProjects = `IN (SELECT rp.project_id FROM projects rp WHERE ${projScope.sql})`;
  const peopleScope = employeeScope(req.user, 'emp');

  const projectParams = projectId ? [Number(projectId)] : [];
  const taskFilter = `${projectId ? ' AND t.project_id = ?' : ''} AND t.project_id ${visibleProjects}`;
  const logProject = `${projectId ? ' AND tt.project_id = ?' : ''} AND tt.project_id ${visibleProjects}`;

  const logParams = [];
  let logFilter = '';
  if (from) { logFilter += ' AND tl.log_date >= ?'; logParams.push(from); }
  if (to) { logFilter += ' AND tl.log_date <= ?'; logParams.push(to); }
  const logSubqueryParams = [...logParams, ...projectParams, ...projScope.params];

  const whereParams = [];
  let where = `WHERE emp.role IN (?) AND ${peopleScope.sql}`;
  whereParams.push(TASK_HOLDER_ROLES, ...peopleScope.params);
  if (departmentId) { where += ' AND emp.department_id = ?'; whereParams.push(Number(departmentId)); }
  if (teamId) { where += ' AND emp.team_id = ?'; whereParams.push(Number(teamId)); }

  const logsFrom = `FROM time_logs tl JOIN tasks tt ON tt.task_id = tl.task_id
                    WHERE tl.employee_id = emp.employee_id ${logFilter}${logProject}`;

  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT emp.employee_id, emp.name, d.name AS department_name,
              (SELECT COUNT(*) FROM tasks t WHERE t.employee_id = emp.employee_id ${taskFilter}) AS task_count,
              (SELECT COUNT(tl.end_time) ${logsFrom}) AS session_count,
              (SELECT COALESCE(SUM(tl.duration_minutes), 0) / 60 ${logsFrom}) AS total_hours
         FROM employees emp
         LEFT JOIN departments d ON d.department_id = emp.department_id
         ${where}
     ) report
     WHERE report.task_count > 0 OR report.session_count > 0
     ORDER BY report.total_hours DESC, report.name`,
    [...projectParams, ...projScope.params, ...logSubqueryParams, ...logSubqueryParams, ...whereParams]
  );

  res.json({
    employees: rows.map((r) => ({
      employeeId: r.employee_id,
      name: r.name,
      department: r.department_name,
      taskCount: Number(r.task_count),
      sessionCount: Number(r.session_count),
      totalHours: Math.round(Number(r.total_hours) * 10) / 10,
    })),
  });
});

// Hours logged in one calendar month (SRS §45 monthly summary), by project,
// department and person, limited to the work the caller may see. Hours belong
// to whoever logged them and count in the month the session was logged.
const monthlySummary = asyncHandler(async (req, res) => {
  await autoStopStaleSessions();
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw ApiError.badRequest('month must be in YYYY-MM format.');

  const ts = taskScope(req.user);
  const grouped = async (key, label, extra = '') => {
    const [rows] = await pool.query(
      `SELECT ${key} AS id, ${label} AS name, ${extra}
              COALESCE(SUM(tl.duration_minutes), 0) / 60 AS hours,
              COUNT(DISTINCT t.task_id) AS tasks,
              COUNT(tl.log_id) AS sessions
         FROM time_logs tl
         JOIN tasks t ON t.task_id = tl.task_id
         JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
         JOIN departments d ON d.department_id = sd.department_id
         JOIN employees emp ON emp.employee_id = t.employee_id
         JOIN employees lg ON lg.employee_id = tl.employee_id
         JOIN projects p ON p.project_id = t.project_id
        WHERE DATE_FORMAT(tl.log_date, '%Y-%m') = ? AND tl.end_time IS NOT NULL AND ${ts.sql}
        GROUP BY ${key}, ${label}
        ORDER BY hours DESC, name`,
      [month, ...ts.params]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, ...(extra ? { jobCode: r.job_code } : {}), hours: Math.round(Number(r.hours) * 10) / 10, tasks: Number(r.tasks), sessions: Number(r.sessions) }));
  };

  const byProject = await grouped('p.project_id', 'p.name', 'p.job_code AS job_code,');
  const byDepartment = await grouped('d.department_id', 'd.name');
  const byEmployee = await grouped('lg.employee_id', 'lg.name');
  res.json({
    month,
    totalHours: Math.round(byProject.reduce((sum, r) => sum + r.hours, 0) * 10) / 10,
    byProject,
    byDepartment,
    byEmployee,
  });
});

// ---------------------------------------------------------------------------
// Employee daily / weekly / monthly report (SRS section 28)
// ---------------------------------------------------------------------------

const round1 = (n) => Math.round(Number(n) * 10) / 10;

const LOG_JOINS = `FROM time_logs tl
       JOIN tasks t ON t.task_id = tl.task_id
       JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
       JOIN departments d ON d.department_id = sd.department_id
       JOIN employees emp ON emp.employee_id = t.employee_id
       JOIN employees lg ON lg.employee_id = tl.employee_id
       JOIN projects p ON p.project_id = t.project_id`;

const TASK_JOINS = `FROM tasks t
       JOIN sub_departments sd ON sd.sub_department_id = t.sub_department_id
       JOIN departments d ON d.department_id = sd.department_id
       JOIN employees emp ON emp.employee_id = t.employee_id
       JOIN projects p ON p.project_id = t.project_id`;

// Hours logged in a date range, grouped. `scope` limits to the tasks the viewer
// may see; `loggerId` limits to one person's own logging.
async function groupedHours({ key, label, scope, range, loggerId = null, extra = '' }) {
  const [rows] = await pool.query(
    `SELECT ${key} AS id, ${label} AS name, ${extra}
            COALESCE(SUM(tl.duration_minutes), 0) / 60 AS hours,
            COUNT(DISTINCT t.task_id) AS tasks,
            COUNT(tl.log_id) AS sessions
       ${LOG_JOINS}
      WHERE tl.log_date BETWEEN ? AND ? AND tl.end_time IS NOT NULL
        ${loggerId ? 'AND tl.employee_id = ?' : ''} AND ${scope.sql}
      GROUP BY ${key}, ${label}
      ORDER BY hours DESC, name`,
    [range.from, range.to, ...(loggerId ? [loggerId] : []), ...scope.params]
  );
  return rows;
}

async function dailySeries({ scope, range, loggerId = null }) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(tl.log_date, '%Y-%m-%d') AS day, COALESCE(SUM(tl.duration_minutes), 0) / 60 AS hours
       ${LOG_JOINS}
      WHERE tl.log_date BETWEEN ? AND ? AND tl.end_time IS NOT NULL
        ${loggerId ? 'AND tl.employee_id = ?' : ''} AND ${scope.sql}
      GROUP BY tl.log_date`,
    [range.from, range.to, ...(loggerId ? [loggerId] : []), ...scope.params]
  );
  const byDay = new Map(rows.map((r) => [r.day, round1(r.hours)]));
  return range.days.map((day) => ({ date: day, hours: byDay.get(day) || 0 }));
}

const asRows = (rows, withCode) => rows.map((r) => ({
  id: r.id, name: r.name, ...(withCode ? { jobCode: r.job_code } : {}),
  hours: round1(r.hours), tasks: Number(r.tasks), sessions: Number(r.sessions),
}));

const employeeReport = asyncHandler(async (req, res) => {
  const range = periodRange(req.query.period, req.query.date);
  if (range.error) throw ApiError.badRequest(range.error);

  const [rows] = await pool.query(
    `SELECT e.employee_id, e.name, e.designation, e.role, e.status, d.name AS department_name, tm.name AS team_name
       FROM employees e LEFT JOIN departments d ON d.department_id = e.department_id LEFT JOIN teams tm ON tm.team_id = e.team_id
      WHERE e.employee_id = ?`,
    [req.params.id]
  );
  const target = rows[0];
  if (!target) throw ApiError.notFound('Employee not found.');

  const self = target.employee_id === req.user.id;
  if (self) {
    if (!can(req.user.role, 'my-work') && !can(req.user.role, 'reports.view')) throw ApiError.forbidden('Your role does not have a work report.');
  } else {
    if (!can(req.user.role, 'reports.view')) throw ApiError.forbidden('Your role does not allow this report.');
    const ps = employeeScope(req.user, 'e');
    const [visible] = await pool.query(`SELECT 1 FROM employees e WHERE e.employee_id = ? AND ${ps.sql}`, [target.employee_id, ...ps.params]);
    if (!visible.length) throw ApiError.forbidden('You cannot view this person report.');
  }
  if (!TASK_HOLDER_ROLES.includes(target.role)) throw ApiError.notFound('This person does not log project work.');

  await autoStopStaleSessions(target.employee_id);
  // Your own report covers everything you logged; anyone else's, only the work the viewer may see.
  const scope = self ? ALLOW : taskScope(req.user);

  const byProject = await groupedHours({ key: 'p.project_id', label: 'p.name', scope, range, loggerId: target.employee_id, extra: 'p.job_code AS job_code,' });
  const byCategory = await groupedHours({ key: "COALESCE(t.category, 'Uncategorised')", label: "COALESCE(t.category, 'Uncategorised')", scope, range, loggerId: target.employee_id });
  const daily = await dailySeries({ scope, range, loggerId: target.employee_id });

  // Their current work, and what they finished in the period.
  const [statusRows] = await pool.query(
    `SELECT t.status, COUNT(*) AS n, COALESCE(SUM(t.allocated_hours), 0) AS planned ${TASK_JOINS}
      WHERE t.employee_id = ? AND ${scope.sql} GROUP BY t.status`,
    [target.employee_id, ...scope.params]
  );
  const [[done]] = await pool.query(
    `SELECT COUNT(*) AS n ${TASK_JOINS}
      WHERE t.employee_id = ? AND t.completed_at >= ? AND t.completed_at < ? + INTERVAL 1 DAY AND ${scope.sql}`,
    [target.employee_id, range.from, range.to, ...scope.params]
  );

  const totalHours = round1(daily.reduce((sum, d) => sum + d.hours, 0));
  const worked = daily.filter((d) => d.hours > 0);
  res.json({
    employee: { id: target.employee_id, name: target.name, designation: target.designation, department: target.department_name, team: target.team_name, status: target.status },
    period: range.period,
    from: range.from,
    to: range.to,
    totalHours,
    sessionCount: byProject.reduce((sum, r) => sum + Number(r.sessions), 0),
    daysWorked: worked.length,
    averageHoursPerDayWorked: worked.length ? round1(totalHours / worked.length) : 0,
    byProject: asRows(byProject, true),
    byCategory: asRows(byCategory),
    daily,
    taskStatus: Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)])),
    openPlannedHours: round1(statusRows.filter((r) => r.status !== 'Completed').reduce((sum, r) => sum + Number(r.planned), 0)),
    tasksCompletedInPeriod: Number(done.n),
  });
});

// ---------------------------------------------------------------------------
// Period summary: end of day, weekly, monthly (SRS sections 31 to 33)
// ---------------------------------------------------------------------------

const summaryReport = asyncHandler(async (req, res) => {
  const range = periodRange(req.query.period, req.query.date);
  if (range.error) throw ApiError.badRequest(range.error);
  await autoStopStaleSessions();

  const scope = taskScope(req.user);
  const byProject = asRows(await groupedHours({ key: 'p.project_id', label: 'p.name', scope, range, extra: 'p.job_code AS job_code,' }), true);
  const byDepartment = asRows(await groupedHours({ key: 'd.department_id', label: 'd.name', scope, range }));
  const byEmployee = asRows(await groupedHours({ key: 'lg.employee_id', label: 'lg.name', scope, range }));
  const byCategory = asRows(await groupedHours({ key: "COALESCE(t.category, 'Uncategorised')", label: "COALESCE(t.category, 'Uncategorised')", scope, range }));
  const daily = await dailySeries({ scope, range });

  const [[done]] = await pool.query(
    `SELECT COUNT(*) AS n ${TASK_JOINS} WHERE t.completed_at >= ? AND t.completed_at < ? + INTERVAL 1 DAY AND ${scope.sql}`,
    [range.from, range.to, ...scope.params]
  );
  const [[overdue]] = await pool.query(
    `SELECT COUNT(*) AS n ${TASK_JOINS} WHERE t.status <> 'Completed' AND t.due_date IS NOT NULL AND t.due_date < CURDATE() AND ${scope.sql}`,
    scope.params
  );

  // People without hours: only for the roles that look after people.
  let people = null;
  if (DASHBOARD_KIND[req.user.role]) {
    const ps = employeeScope(req.user, 'emp');
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(EXISTS (SELECT 1 FROM time_logs tl WHERE tl.employee_id = emp.employee_id AND tl.log_date BETWEEN ? AND ? AND tl.end_time IS NOT NULL)) AS logged
         FROM employees emp WHERE emp.status = 'active' AND emp.role IN (?) AND ${ps.sql}`,
      [range.from, range.to, TASK_HOLDER_ROLES, ...ps.params]
    );
    const withHours = Number(row.logged || 0);
    people = { total: Number(row.total), withHours, withoutHours: Number(row.total) - withHours };
  }

  const health = await projectHealth(req.user, { includeCompleted: false });
  const exceptions = await exceptionsFor(req.user);

  res.json({
    period: range.period,
    from: range.from,
    to: range.to,
    totalHours: round1(byProject.reduce((sum, r) => sum + r.hours, 0)),
    sessionCount: byProject.reduce((sum, r) => sum + r.sessions, 0),
    peopleWhoLogged: byEmployee.length,
    people,
    tasksCompleted: Number(done.n),
    overdueTasks: Number(overdue.n),
    byProject,
    byDepartment,
    byEmployee,
    byCategory,
    daily,
    topProjects: byProject.slice(0, 5),
    projectsNearingBudget: health
      .filter((p) => p.risk !== 'GREEN')
      .map((p) => ({ id: p.id, name: p.name, jobCode: p.jobCode, consumedPercent: p.consumedPercent, completionPercent: p.completionPercent, risk: p.risk })),
    majorExceptions: exceptions.filter((e) => e.severity === 'critical').slice(0, 8),
  });
});

module.exports = { projectDetailsReport, employeeWorkTimeReport, monthlySummary, employeeReport, summaryReport };
