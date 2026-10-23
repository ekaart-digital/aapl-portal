// The seven roles from SRS section 34. What each may do is decided by the
// server; the browser is told through `user.permissions` and only uses this
// file for labels, form choices and where to land after signing in.

export const ROLE_LABELS = {
  employee: 'Employee',
  team_leader: 'Team Leader',
  department_head: 'Department Head',
  project_manager: 'Project Manager',
  hr_admin: 'HR / Admin',
  management: 'Management',
  system_admin: 'System Administrator',
};

export const ALL_ROLES = Object.keys(ROLE_LABELS);

// Roles HR/Admin may create; the System Administrator may create any.
export const HR_ASSIGNABLE_ROLES = ['employee', 'team_leader', 'department_head', 'project_manager'];

// Roles that work inside a department (and so need one); the others have no discipline.
export const DEPARTMENT_ROLES = ['employee', 'team_leader', 'department_head'];

// Roles that can belong to a team.
export const TEAM_MEMBER_ROLES = ['employee', 'team_leader'];

export const roleLabel = (role) => ROLE_LABELS[role] || role;

// Where each role starts. Updated as each role's own home screen is built.
const LANDING = {
  employee: '/my-tasks',
  team_leader: '/team',
  department_head: '/department',
  project_manager: '/projects',
  hr_admin: '/employees',
  management: '/dashboard',
  system_admin: '/admin',
};

export function landingFor(user) {
  return LANDING[user?.role] || '/notifications';
}
