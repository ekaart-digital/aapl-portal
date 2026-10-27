import { describe, it, expect, afterEach } from 'vitest';
import { navFor } from './data/navConfig';
import { featureOn, roleOpen } from './auth/rollout';
import { person, authOf } from './test/fixtures';

// What each rollout batch shows. The permissions come from the backend's own
// table (the same one the server uses), so these screens cannot drift from what
// the server really allows.
const labelsFor = (role, batch) => {
  process.env.ROLLOUT_BATCH = String(batch);
  const user = person({ id: 1, role });
  return navFor(role, authOf(user).can).flatMap((section) => section.items.map((item) => item.label));
};

afterEach(() => { delete process.env.ROLLOUT_BATCH; });

describe('the sidebar in each batch', () => {
  it('batch 1 shows the daily work and project tracking screens only', () => {
    expect(labelsFor('employee', 1)).toEqual(['My Tasks', 'My Progress', 'Notifications']);
    expect(labelsFor('project_manager', 1)).toEqual(['Projects', 'Employees', 'Notifications']);
    expect(labelsFor('hr_admin', 1)).toEqual(['Employees', 'Organisation', 'Audit Trail', 'Notifications']);
    expect(labelsFor('system_admin', 1)).toEqual(['Administration', 'Employees', 'Organisation', 'Audit Trail', 'Notifications']);
  });

  it('batch 1 shows nothing but Notifications for roles that are not open yet', () => {
    for (const role of ['team_leader', 'department_head', 'management']) {
      expect(labelsFor(role, 1), role).toEqual(['Notifications']);
    }
  });

  it('batch 2 adds the team leadership screens', () => {
    expect(labelsFor('team_leader', 2)).toEqual(['Dashboard', 'My Tasks', 'My Progress', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Notifications']);
    expect(labelsFor('department_head', 2)).toEqual(['Dashboard', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Notifications']);
    expect(labelsFor('project_manager', 2)).toEqual(['Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Notifications']);
    expect(labelsFor('employee', 2)).toEqual(['My Tasks', 'My Progress', 'Notifications']);
  });

  it('batch 3 adds time corrections and approvals', () => {
    expect(labelsFor('employee', 3)).toEqual(['My Tasks', 'My Progress', 'My Time', 'Notifications']);
    expect(labelsFor('project_manager', 3)).toEqual(['Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Approvals', 'Notifications']);
    expect(labelsFor('team_leader', 3)).toContain('Approvals');
    expect(labelsFor('team_leader', 3)).toContain('My Time');
  });

  it('batch 4 adds management and the reports', () => {
    expect(labelsFor('management', 4)).toEqual(['Dashboard', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Reports', 'Work Report', 'Summary', 'Audit Trail', 'Notifications']);
    expect(labelsFor('employee', 4)).toEqual(['My Tasks', 'My Progress', 'My Time', 'My Report', 'Notifications']);
    expect(labelsFor('project_manager', 4)).toEqual(['Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Approvals', 'Reports', 'Work Report', 'Summary', 'Notifications']);
  });

  it('batch 5 and an unset setting show everything', () => {
    const all = labelsFor('management', 5);
    delete process.env.ROLLOUT_BATCH;
    const user = person({ id: 1, role: 'management' });
    const unset = navFor('management', authOf(user).can).flatMap((s) => s.items.map((i) => i.label));
    expect(unset).toEqual(all);
    expect(labelsFor('team_leader', 5)).toEqual(['Dashboard', 'My Tasks', 'My Progress', 'My Time', 'My Report', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Approvals', 'Reports', 'Work Report', 'Summary', 'Notifications']);
  });

  it('every batch keeps what the batches before it opened', () => {
    for (const role of ['employee', 'project_manager', 'team_leader', 'department_head', 'management', 'hr_admin', 'system_admin']) {
      for (let batch = 2; batch <= 5; batch += 1) {
        const before = labelsFor(role, batch - 1);
        const now = labelsFor(role, batch);
        for (const label of before) expect(now, `${role}: "${label}" at batch ${batch}`).toContain(label);
      }
    }
  });
});

describe('featureOn and roleOpen', () => {
  const batch1 = {
    rollout: {
      batch: 1,
      roles: ['employee', 'project_manager', 'hr_admin', 'system_admin'],
      features: { categories: false, photos: false, overtime: false, manHours: false, projectExtras: false },
    },
  };

  it('follow what the server says is open', () => {
    expect(featureOn(batch1, 'categories')).toBe(false);
    expect(featureOn({ rollout: { features: { categories: true } } }, 'categories')).toBe(true);
    expect(roleOpen(batch1, 'team_leader')).toBe(false);
    expect(roleOpen(batch1, 'project_manager')).toBe(true);
  });

  it('count everything as open when the server says nothing, so older servers keep working', () => {
    expect(featureOn({}, 'categories')).toBe(true);
    expect(featureOn(null, 'categories')).toBe(true);
    expect(featureOn(undefined, 'photos')).toBe(true);
    expect(featureOn({ rollout: { features: {} } }, 'photos')).toBe(true);
    expect(roleOpen({}, 'management')).toBe(true);
    expect(roleOpen(null, 'management')).toBe(true);
  });
});
