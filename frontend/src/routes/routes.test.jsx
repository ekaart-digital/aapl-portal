import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { routes } from './routes';
import { navConfig, navFor } from '../data/navConfig';
import { landingFor, ALL_ROLES } from '../auth/roles';
import { ALL_PERSONAS, authOf, person } from '../test/fixtures';

// The capability a route is behind: every RequireCapability on the way down.
function capabilitiesFor(path) {
  const matches = matchRoutes(routes, path) || [];
  return matches
    .map((m) => m.route.element)
    .filter((el) => el && el.props && el.props.capability)
    .map((el) => el.props.capability);
}

const personas = Object.values(ALL_PERSONAS);

describe('the route table', () => {
  it('has a screen for every role\'s landing page, and that role may open it', () => {
    for (const user of personas) {
      const landing = landingFor(user);
      expect(matchRoutes(routes, landing), `${user.role} lands on ${landing}`).not.toBeNull();
      const { can } = authOf(user);
      for (const capability of capabilitiesFor(landing)) {
        expect(can(capability), `${user.role} must hold "${capability}" to open ${landing}`).toBe(true);
      }
    }
  });

  it('covers every one of the seven roles', () => {
    expect(ALL_ROLES.length).toBe(7);
    expect(personas.map((p) => p.role).sort()).toEqual([...ALL_ROLES].sort());
  });

  it('every sidebar item points to a real screen guarded by the same capability', () => {
    for (const section of navConfig) {
      for (const item of section.items) {
        expect(matchRoutes(routes, item.path), item.path).not.toBeNull();
        if (item.requires) expect(capabilitiesFor(item.path), item.path).toContain(item.requires);
      }
    }
  });

  it('nothing in the sidebar leads a role to a screen it cannot open', () => {
    for (const user of personas) {
      const { can } = authOf(user);
      for (const section of navFor(user.role, can)) {
        for (const item of section.items) {
          for (const capability of capabilitiesFor(item.path)) {
            expect(can(capability), `${user.role} sees "${item.label}" but lacks "${capability}"`).toBe(true);
          }
        }
      }
    }
  });

  it('every role has something to open in the sidebar, including Notifications', () => {
    for (const user of personas) {
      const items = navFor(user.role, authOf(user).can).flatMap((s) => s.items.map((i) => i.label));
      expect(items.length, user.role).toBeGreaterThan(1);
      expect(items, user.role).toContain('Notifications');
    }
  });

  it('shows each role the right screens', () => {
    const labels = (user) => navFor(user.role, authOf(user).can).flatMap((s) => s.items.map((i) => i.label));
    expect(labels(ALL_PERSONAS.employee)).toEqual(['My Tasks', 'My Progress', 'My Time', 'My Report', 'Notifications']);
    expect(labels(ALL_PERSONAS.manager)).toEqual(['Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Approvals', 'Reports', 'Work Report', 'Summary', 'Notifications']);
    expect(labels(ALL_PERSONAS.hrAdmin)).toEqual(['Employees', 'Organisation', 'Audit Trail', 'Notifications']);
    expect(labels(ALL_PERSONAS.systemAdmin)).toEqual(['Administration', 'Employees', 'Organisation', 'Audit Trail', 'Notifications']);
    expect(labels(ALL_PERSONAS.management)).toEqual(['Dashboard', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Reports', 'Work Report', 'Summary', 'Audit Trail', 'Notifications']);
    expect(labels(ALL_PERSONAS.teamLeader)).toEqual(['Dashboard', 'My Tasks', 'My Progress', 'My Time', 'My Report', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Approvals', 'Reports', 'Work Report', 'Summary', 'Notifications']);
    expect(labels(ALL_PERSONAS.departmentHead)).toEqual(['Dashboard', 'Projects', 'Employees', 'Man-Hours', 'Exceptions', 'Approvals', 'Reports', 'Work Report', 'Summary', 'Notifications']);
  });

  it('an unknown role gets only what its (empty) permissions allow', () => {
    const stranger = person({ role: 'nonsense' });
    const items = navFor('nonsense', authOf(stranger).can).flatMap((s) => s.items.map((i) => i.label));
    expect(items).toEqual(['Notifications']);
    expect(landingFor(stranger)).toBe('/notifications');
  });
});
