// Data scope: which rows each role may see and act on. A role's capability
// (permissions.js) says it may use a feature; the functions here limit it to
// its own department, team or projects. SQL fragments take an alias so they
// can be dropped into any query.
//
//   Management ........ everything (read-only in practice)
//   Project Manager ... the projects they manage
//   Department Head ... their department(s): its people, tasks and projects
//   Team Leader ....... their team(s): its people and tasks, plus department projects
//   Employee .......... only their own tasks and the projects those belong to
//   HR/Admin, System Admin ... people only; no project or task data

const pool = require('../config/db');
const { ApiError } = require('../utils/ApiError');
const { ROLES } = require('./permissions');

const ALLOW = { sql: '1 = 1', params: [] };
const DENY = { sql: '1 = 0', params: [] };

const idsOf = (user) => user.scopeDepartmentIds || [];
const teamsOf = (user) => user.teamIds || [];

// Projects the user can see.
function projectScope(user, p = 'p') {
  const deptLink = (ids) => `EXISTS (SELECT 1 FROM project_departments sc_pd WHERE sc_pd.project_id = ${p}.project_id AND sc_pd.department_id IN (?))`;
  const ownTask = `EXISTS (SELECT 1 FROM tasks sc_t WHERE sc_t.project_id = ${p}.project_id AND sc_t.employee_id = ?)`;

  switch (user.role) {
    case ROLES.MANAGEMENT:
      return ALLOW;
    case ROLES.PROJECT_MANAGER:
      return { sql: `${p}.project_manager_id = ?`, params: [user.id] };
    case ROLES.DEPARTMENT_HEAD:
      return idsOf(user).length
        ? { sql: `(${p}.project_manager_id = ? OR ${deptLink()})`, params: [user.id, idsOf(user)] }
        : { sql: `${p}.project_manager_id = ?`, params: [user.id] };
    case ROLES.TEAM_LEADER:
      // Also the projects that name them as the project's team leader.
      return idsOf(user).length
        ? { sql: `(${deptLink()} OR ${ownTask} OR ${p}.team_leader_id = ?)`, params: [idsOf(user), user.id, user.id] }
        : { sql: `(${ownTask} OR ${p}.team_leader_id = ?)`, params: [user.id, user.id] };
    case ROLES.EMPLOYEE:
      return { sql: ownTask, params: [user.id] };
    default:
      return DENY;
  }
}

// Tasks the user can see. Expects the aliases used by the task queries:
// t = tasks, p = projects, d = the task's department, emp = the assignee.
function taskScope(user, a = {}) {
  const { t = 't', p = 'p', d = 'd', emp = 'emp' } = a;
  switch (user.role) {
    case ROLES.MANAGEMENT:
      return ALLOW;
    case ROLES.PROJECT_MANAGER:
      return { sql: `${p}.project_manager_id = ?`, params: [user.id] };
    case ROLES.DEPARTMENT_HEAD:
      return idsOf(user).length
        ? { sql: `(${d}.department_id IN (?) OR ${p}.project_manager_id = ?)`, params: [idsOf(user), user.id] }
        : { sql: `${p}.project_manager_id = ?`, params: [user.id] };
    case ROLES.TEAM_LEADER:
      return teamsOf(user).length
        ? { sql: `(${emp}.team_id IN (?) OR ${t}.employee_id = ?)`, params: [teamsOf(user), user.id] }
        : { sql: `${t}.employee_id = ?`, params: [user.id] };
    case ROLES.EMPLOYEE:
      return { sql: `${t}.employee_id = ?`, params: [user.id] };
    default:
      return DENY;
  }
}

// People the user can see.
function employeeScope(user, e = 'e') {
  switch (user.role) {
    case ROLES.MANAGEMENT:
    case ROLES.HR_ADMIN:
    case ROLES.SYSTEM_ADMIN:
      return ALLOW;
    case ROLES.DEPARTMENT_HEAD:
      return idsOf(user).length
        ? { sql: `(${e}.department_id IN (?) OR ${e}.employee_id = ?)`, params: [idsOf(user), user.id] }
        : { sql: `${e}.employee_id = ?`, params: [user.id] };
    case ROLES.TEAM_LEADER:
      return teamsOf(user).length
        ? { sql: `(${e}.team_id IN (?) OR ${e}.employee_id = ?)`, params: [teamsOf(user), user.id] }
        : { sql: `${e}.employee_id = ?`, params: [user.id] };
    case ROLES.PROJECT_MANAGER:
      return {
        sql: `(${e}.employee_id = ? OR ${e}.department_id IN (
                SELECT sc_pd.department_id FROM project_departments sc_pd
                JOIN projects sc_p ON sc_p.project_id = sc_pd.project_id
               WHERE sc_p.project_manager_id = ?))`,
        params: [user.id, user.id],
      };
    case ROLES.EMPLOYEE:
      return { sql: `${e}.employee_id = ?`, params: [user.id] };
    default:
      return DENY;
  }
}

// Appends a scope to a WHERE clause: `WHERE <existing> AND <scope>`.
function withScope(baseWhere, scope) {
  return { sql: baseWhere ? `${baseWhere} AND ${scope.sql}` : scope.sql, params: scope.params };
}

async function canViewProject(user, projectId) {
  const scope = projectScope(user, 'p');
  const [rows] = await pool.query(`SELECT 1 FROM projects p WHERE p.project_id = ? AND ${scope.sql}`, [projectId, ...scope.params]);
  return rows.length > 0;
}

async function assertCanViewProject(user, projectId) {
  if (await canViewProject(user, projectId)) return;
  const [exists] = await pool.query('SELECT 1 FROM projects WHERE project_id = ?', [projectId]);
  throw exists.length ? ApiError.forbidden('You do not have access to this project.') : ApiError.notFound('Project not found.');
}

// May the user edit this project and allocate work on it? The project's own
// manager, or a Department Head whose department is part of the project.
async function canManageProject(user, projectId) {
  if (user.role === ROLES.PROJECT_MANAGER) {
    const [rows] = await pool.query('SELECT 1 FROM projects WHERE project_id = ? AND project_manager_id = ?', [projectId, user.id]);
    return rows.length > 0;
  }
  if (user.role === ROLES.DEPARTMENT_HEAD) {
    const [rows] = await pool.query(
      `SELECT 1 FROM projects p WHERE p.project_id = ? AND (p.project_manager_id = ? OR ${idsOf(user).length
        ? 'EXISTS (SELECT 1 FROM project_departments sc_pd WHERE sc_pd.project_id = p.project_id AND sc_pd.department_id IN (?))'
        : '1 = 0'})`,
      idsOf(user).length ? [projectId, user.id, idsOf(user)] : [projectId, user.id]
    );
    return rows.length > 0;
  }
  return false;
}

async function assertCanManageProject(user, projectId) {
  if (!(await canManageProject(user, projectId))) throw ApiError.forbidden('You cannot change this project.');
}

// May the user give work to this person on this project? The project's
// manager (any department of the project), a Department Head for their own
// department's people, a Team Leader for their own team's people.
async function canAllocateTo(user, projectId, employee) {
  if (user.role === ROLES.PROJECT_MANAGER) return canManageProject(user, projectId);
  if (user.role === ROLES.DEPARTMENT_HEAD) {
    return (await canManageProject(user, projectId)) && idsOf(user).includes(employee.department_id);
  }
  if (user.role === ROLES.TEAM_LEADER) {
    return employee.employee_id === user.id || (employee.team_id != null && teamsOf(user).includes(employee.team_id));
  }
  return false;
}

// The people this user may give work to on this project, from a list of
// candidates (active Employees/Team Leaders of the project's departments).
// Mirrors canAllocateTo, without a query per person.
async function filterAllocatable(user, projectId, candidates) {
  if (user.role === ROLES.PROJECT_MANAGER) return (await canManageProject(user, projectId)) ? candidates : [];
  if (user.role === ROLES.DEPARTMENT_HEAD) {
    return (await canManageProject(user, projectId)) ? candidates.filter((e) => idsOf(user).includes(e.department_id)) : [];
  }
  if (user.role === ROLES.TEAM_LEADER) {
    return candidates.filter((e) => e.employee_id === user.id || (e.team_id != null && teamsOf(user).includes(e.team_id)));
  }
  return [];
}

// May the user review (adjust, approve corrections for) time logged by this
// person on this project? Their Team Leader, their Department Head, or the
// project's manager — never the person themselves.
async function canReviewTimeOf(user, employee, projectId) {
  // Nobody signs off their own time.
  if (employee.employee_id === user.id) return false;
  switch (user.role) {
    case ROLES.TEAM_LEADER:
      return employee.team_id != null && teamsOf(user).includes(employee.team_id);
    case ROLES.DEPARTMENT_HEAD:
      return idsOf(user).includes(employee.department_id);
    case ROLES.PROJECT_MANAGER: {
      const [rows] = await pool.query('SELECT 1 FROM projects WHERE project_id = ? AND project_manager_id = ?', [projectId, user.id]);
      return rows.length > 0;
    }
    default:
      return false;
  }
}

// SQL version of canReviewTimeOf for list queries. `e` is the person who
// logged the time, `p` the project.
function reviewScope(user, e = 'e', p = 'p') {
  const own = (scope) => (scope === DENY ? DENY : { sql: `(${scope.sql} AND ${e}.employee_id <> ?)`, params: [...scope.params, user.id] });
  switch (user.role) {
    case ROLES.TEAM_LEADER:
      return own(teamsOf(user).length ? { sql: `${e}.team_id IN (?)`, params: [teamsOf(user)] } : DENY);
    case ROLES.DEPARTMENT_HEAD: {
      const parts = [];
      const params = [];
      if (idsOf(user).length) { parts.push(`${e}.department_id IN (?)`); params.push(idsOf(user)); }
      parts.push(`${p}.project_manager_id = ?`); params.push(user.id);
      return own({ sql: `(${parts.join(' OR ')})`, params });
    }
    case ROLES.PROJECT_MANAGER:
      return own({ sql: `${p}.project_manager_id = ?`, params: [user.id] });
    default:
      return DENY;
  }
}

module.exports = {
  ALLOW,
  DENY,
  projectScope,
  taskScope,
  employeeScope,
  withScope,
  canViewProject,
  assertCanViewProject,
  canManageProject,
  assertCanManageProject,
  canAllocateTo,
  filterAllocatable,
  canReviewTimeOf,
  reviewScope,
};
