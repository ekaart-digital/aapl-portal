// The role model from SRS §34. Every account has exactly one role. What a role
// may see is further limited by data it is connected to (its department, team
// or projects) — see scope.js. This file only answers "may this role use this
// feature at all?", and is the single source the UI is told about.

const ROLES = {
  EMPLOYEE: 'employee',
  TEAM_LEADER: 'team_leader',
  DEPARTMENT_HEAD: 'department_head',
  PROJECT_MANAGER: 'project_manager',
  HR_ADMIN: 'hr_admin',
  MANAGEMENT: 'management',
  SYSTEM_ADMIN: 'system_admin',
};

const ALL_ROLES = Object.values(ROLES);

const ROLE_LABELS = {
  employee: 'Employee',
  team_leader: 'Team Leader',
  department_head: 'Department Head',
  project_manager: 'Project Manager',
  hr_admin: 'HR / Admin',
  management: 'Management',
  system_admin: 'System Administrator',
};

// Who can be given work and run the project timer.
const TASK_HOLDER_ROLES = [ROLES.EMPLOYEE, ROLES.TEAM_LEADER];

// Who can be named the project manager of a project.
const PROJECT_MANAGER_ROLES = [ROLES.PROJECT_MANAGER, ROLES.DEPARTMENT_HEAD];

// Roles with no discipline of their own (no department, no tasks).
const NO_DEPARTMENT_ROLES = [ROLES.PROJECT_MANAGER, ROLES.HR_ADMIN, ROLES.MANAGEMENT, ROLES.SYSTEM_ADMIN];

// Roles HR/Admin may create. The powerful ones are reserved for the System Administrator.
const HR_ASSIGNABLE_ROLES = [ROLES.EMPLOYEE, ROLES.TEAM_LEADER, ROLES.DEPARTMENT_HEAD, ROLES.PROJECT_MANAGER];

const { EMPLOYEE, TEAM_LEADER, DEPARTMENT_HEAD, PROJECT_MANAGER, HR_ADMIN, MANAGEMENT, SYSTEM_ADMIN } = ROLES;

const CAPABILITIES = {
  // Personal work
  'my-work': [EMPLOYEE, TEAM_LEADER],
  'corrections.request': [EMPLOYEE, TEAM_LEADER],

  // Projects and tasks (the data each can reach is scoped in scope.js)
  'projects.view': [EMPLOYEE, TEAM_LEADER, DEPARTMENT_HEAD, PROJECT_MANAGER, MANAGEMENT],
  'projects.create': [PROJECT_MANAGER, DEPARTMENT_HEAD],
  'projects.edit': [PROJECT_MANAGER, DEPARTMENT_HEAD],
  'tasks.allocate': [PROJECT_MANAGER, DEPARTMENT_HEAD, TEAM_LEADER],

  // Reviewing time: auto-stopped sessions, corrections and approvals
  'sessions.review': [PROJECT_MANAGER, DEPARTMENT_HEAD, TEAM_LEADER],

  // People and structure
  'employees.view': [TEAM_LEADER, DEPARTMENT_HEAD, PROJECT_MANAGER, HR_ADMIN, MANAGEMENT, SYSTEM_ADMIN],
  'employees.manage': [HR_ADMIN, SYSTEM_ADMIN],
  'roles.assign': [SYSTEM_ADMIN],
  'structure.manage': [HR_ADMIN, SYSTEM_ADMIN],

  // Insight
  'reports.view': [TEAM_LEADER, DEPARTMENT_HEAD, PROJECT_MANAGER, MANAGEMENT],
  'exceptions.view': [TEAM_LEADER, DEPARTMENT_HEAD, PROJECT_MANAGER, MANAGEMENT],
  'audit.view': [HR_ADMIN, MANAGEMENT, SYSTEM_ADMIN],
  'dashboard.company': [MANAGEMENT],
  'dashboard.department': [DEPARTMENT_HEAD],
  'dashboard.team': [TEAM_LEADER],

  // Administration
  'settings.manage': [SYSTEM_ADMIN],
  'system.health': [SYSTEM_ADMIN],
};

const LANDING = {
  employee: '/my-tasks',
  team_leader: '/team',
  department_head: '/department',
  project_manager: '/projects',
  hr_admin: '/employees',
  management: '/dashboard',
  system_admin: '/admin',
};

function can(role, capability) {
  const roles = CAPABILITIES[capability];
  return Boolean(roles && roles.includes(role));
}

function permissionsFor(role) {
  return Object.keys(CAPABILITIES).filter((capability) => CAPABILITIES[capability].includes(role));
}

function landingFor(role) {
  return LANDING[role] || '/';
}

module.exports = {
  ROLES,
  ALL_ROLES,
  ROLE_LABELS,
  TASK_HOLDER_ROLES,
  PROJECT_MANAGER_ROLES,
  NO_DEPARTMENT_ROLES,
  HR_ASSIGNABLE_ROLES,
  CAPABILITIES,
  can,
  permissionsFor,
  landingFor,
};
