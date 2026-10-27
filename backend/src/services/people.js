const { ROLE_LABELS, permissionsFor, landingFor } = require('../auth/permissions');
const settings = require('./settings');
const { featureOn, rolloutInfo } = require('../config/rollout');

// One employee row with their department, team and reporting lines (SRS §6:
// reporting Team Leader and reporting Department Head).
const EMPLOYEE_SELECT = `
  SELECT e.employee_id, e.name, e.email, e.password_hash, e.department_id, e.team_id, e.designation, e.role, e.status,
         e.date_of_joining, e.mobile_number, e.overtime_eligible, e.created_at, e.updated_at,
         (e.photo IS NOT NULL) AS has_photo,
         (SELECT GROUP_CONCAT(DISTINCT pj.name ORDER BY pj.name SEPARATOR '||')
            FROM tasks tk JOIN projects pj ON pj.project_id = tk.project_id
           WHERE tk.employee_id = e.employee_id AND tk.status <> 'Completed' AND pj.status <> 'Completed') AS current_projects,
         d.name AS department_name, d.head_id AS department_head_id, dh.name AS department_head_name,
         tm.name AS team_name, tm.leader_id AS team_leader_id, tl.name AS team_leader_name
    FROM employees e
    LEFT JOIN departments d ON d.department_id = e.department_id
    LEFT JOIN employees dh ON dh.employee_id = d.head_id
    LEFT JOIN teams tm ON tm.team_id = e.team_id
    LEFT JOIN employees tl ON tl.employee_id = tm.leader_id
`;

// `showProjects`: the viewer may see project data (HR/Admin and the System
// Administrator hold people data only, so the allocation is left out for them).
function toPublicEmployee(row, showProjects = false) {
  return {
    ...(featureOn('overtime') ? { overtimeEligible: Boolean(row.overtime_eligible) } : {}),
    ...(featureOn('photos') ? { hasPhoto: Boolean(row.has_photo) } : {}),
    ...(showProjects && featureOn('currentProjects') ? { currentProjects: row.current_projects ? row.current_projects.split('||') : [] } : {}),
    id: row.employee_id,
    name: row.name,
    email: row.email,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    designation: row.designation,
    department: row.department_name || null,
    departmentId: row.department_id,
    teamId: row.team_id,
    team: row.team_name || null,
    // Nobody reports to themselves: a team leader has no team leader above them in
    // their own team, and a department head is the head.
    reportsToTeamLeader: row.team_leader_id && row.team_leader_id !== row.employee_id
      ? { id: row.team_leader_id, name: row.team_leader_name } : null,
    reportsToDepartmentHead: row.department_head_id && row.department_head_id !== row.employee_id
      ? { id: row.department_head_id, name: row.department_head_name } : null,
    dateOfJoining: row.date_of_joining || null,
    mobileNumber: row.mobile_number || null,
    status: row.status,
  };
}

// The signed-in user: the public record plus what their role may do.
function toSessionUser(row) {
  return {
    ...toPublicEmployee(row),
    permissions: permissionsFor(row.role),
    landing: landingFor(row.role),
    // Minutes of inactivity before the browser signs this person out. Employees
    // are exempt while a timer is running; that is handled in the browser.
    sessionTimeoutMinutes: settings.get('sessionTimeoutMinutes'),
    // Which batch is open, so the screens show only what is available.
    rollout: rolloutInfo(),
  };
}

module.exports = { EMPLOYEE_SELECT, toPublicEmployee, toSessionUser };
