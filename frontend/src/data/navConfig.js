// Sidebar sections. An item shows when the signed-in role holds its
// `requires` capability (and is not listed in `hiddenFor`).
export const navConfig = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', path: '/team', icon: 'LayoutDashboard', requires: 'dashboard.team' },
      { label: 'Dashboard', path: '/department', icon: 'LayoutDashboard', requires: 'dashboard.department' },
      { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', requires: 'dashboard.company' },
      { label: 'Administration', path: '/admin', icon: 'Settings', requires: 'system.health' },
    ],
  },
  {
    label: 'My Work',
    items: [
      { label: 'My Tasks', path: '/my-tasks', icon: 'Clock', requires: 'my-work' },
      { label: 'My Progress', path: '/my-progress', icon: 'FolderKanban', requires: 'my-work' },
      { label: 'My Time', path: '/my-time', icon: 'History', requires: 'corrections.request' },
      { label: 'My Report', path: '/my-report', icon: 'FileBarChart', requires: 'reports.own' },
    ],
  },
  {
    label: 'Projects',
    items: [
      { label: 'Projects', path: '/projects', icon: 'FolderKanban', requires: 'projects.view', hiddenFor: ['employee'] },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Employees', path: '/employees', icon: 'Users', requires: 'employees.view' },
      { label: 'Organisation', path: '/structure', icon: 'Building2', requires: 'structure.manage' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Man-Hours', path: '/man-hours', icon: 'TimerReset', requires: 'manhours.view' },
      { label: 'Exceptions', path: '/exceptions', icon: 'AlertTriangle', requires: 'exceptions.view' },
      { label: 'Approvals', path: '/approvals', icon: 'CheckCircle2', requires: 'corrections.review' },
      { label: 'Reports', path: '/reports', icon: 'FileBarChart', requires: 'reports.view' },
      { label: 'Work Report', path: '/work-report', icon: 'User', requires: 'reports.view' },
      { label: 'Summary', path: '/summary', icon: 'CalendarCheck', requires: 'reports.view' },
      { label: 'Audit Trail', path: '/audit', icon: 'ShieldAlert', requires: 'audit.view' },
      { label: 'Notifications', path: '/notifications', icon: 'Bell' },
    ],
  },
];

// The items one role sees, with empty sections removed.
export function navFor(role, can) {
  return navConfig
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (!item.requires || can(item.requires)) && !(item.hiddenFor || []).includes(role)),
    }))
    .filter((section) => section.items.length > 0);
}
