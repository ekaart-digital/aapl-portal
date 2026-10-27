// Which batch of Version 1 is switched on. Set ROLLOUT_BATCH in the server's
// .env and restart the API; nothing inside the application can change it.
//
//   1  Daily work and project tracking   (Employee, Project Manager, HR / Admin, System Administrator)
//   2  Team leadership                   (Team Leader, Department Head, dashboards, man-hours, exceptions)
//   3  Time corrections                  (employee requests and approvals)
//   4  Management reporting              (Management, company dashboard, reports and summaries)
//   5  Refinements                       (categories, photographs, overtime, project extras, email)
//
// A batch includes everything in the batches before it. With ROLLOUT_BATCH
// unset everything is on (development, tests). A value that is set but not
// valid switches on batch 1 only, so a typo can never open more than intended.
//
// Closed features are hidden from the screens (the browser is only told what is
// open) and refused by the server, whatever address or call is used.

const MAX_BATCH = 5;

// The batch in which each role, capability and feature becomes available.
const ROLE_BATCH = {
  employee: 1,
  project_manager: 1,
  hr_admin: 1,
  system_admin: 1,
  team_leader: 2,
  department_head: 2,
  management: 4,
};

const CAPABILITY_BATCH = {
  'my-work': 1,
  'projects.view': 1,
  'projects.create': 1,
  'projects.edit': 1,
  'tasks.allocate': 1,
  'sessions.review': 1,
  'employees.view': 1,
  'employees.manage': 1,
  'roles.assign': 1,
  'structure.manage': 1,
  'audit.view': 1,
  'settings.manage': 1,
  'system.health': 1,

  'dashboard.team': 2,
  'dashboard.department': 2,
  'exceptions.view': 2,
  'manhours.view': 2,

  'corrections.request': 3,
  'corrections.review': 3,

  'dashboard.company': 4,
  'reports.view': 4,
  'reports.own': 4,
};

// Smaller features that are not a screen or a role of their own.
const FEATURE_BATCH = {
  manHours: 2, // completion %, projection and risk on a project
  corrections: 3, // the correction request window setting
  summaries: 4, // daily and weekly summary notifications and their settings
  categories: 5,
  photos: 5,
  overtime: 5,
  currentProjects: 5,
  projectExtras: 5, // team leader, agreed fee and own completion figure on a project
  noAllocation: 5, // the "no allocation" exception
  email: 5, // email copies of notifications and their settings
};

function currentBatch() {
  const raw = process.env.ROLLOUT_BATCH;
  if (raw === undefined || raw === '') return MAX_BATCH;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_BATCH ? n : 1;
}

const isRoleEnabled = (role) => (ROLE_BATCH[role] || MAX_BATCH + 1) <= currentBatch();
const isCapabilityEnabled = (capability) => (CAPABILITY_BATCH[capability] || MAX_BATCH + 1) <= currentBatch();
const featureOn = (feature) => (FEATURE_BATCH[feature] || MAX_BATCH + 1) <= currentBatch();
const enabledRoles = () => Object.keys(ROLE_BATCH).filter(isRoleEnabled);

// What the browser is told about the current rollout.
function rolloutInfo() {
  return {
    batch: currentBatch(),
    roles: enabledRoles(),
    features: Object.fromEntries(Object.keys(FEATURE_BATCH).map((f) => [f, featureOn(f)])),
  };
}

module.exports = {
  MAX_BATCH, ROLE_BATCH, CAPABILITY_BATCH, FEATURE_BATCH,
  currentBatch, isRoleEnabled, isCapabilityEnabled, featureOn, enabledRoles, rolloutInfo,
};
