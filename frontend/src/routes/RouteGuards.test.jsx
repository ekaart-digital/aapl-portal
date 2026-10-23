import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth, RequireCapability, RoleLanding } from './RouteGuards';
import { authOf, manager, employee, teamLeader, departmentHead, hrAdmin, management, systemAdmin } from '../test/fixtures';
import { landingFor } from '../auth/roles';

const auth = vi.hoisted(() => ({ current: { user: null, loading: false } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.current }));

const signedIn = (user) => { auth.current = { ...authOf(user), loading: false }; };

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<RoleLanding />} />
          <Route path="/projects" element={<div>Projects page</div>} />
          <Route path="/my-tasks" element={<div>My tasks page</div>} />
          <Route path="/employees" element={<div>Employees page</div>} />
          <Route path="/team" element={<div>Team dashboard page</div>} />
          <Route path="/department" element={<div>Department dashboard page</div>} />
          <Route path="/dashboard" element={<div>Company dashboard page</div>} />
          <Route path="/admin" element={<div>Administration page</div>} />
          <Route element={<RequireCapability capability="reports.view" />}>
            <Route path="/reports" element={<div>Reports page</div>} />
          </Route>
          <Route element={<RequireCapability capability="structure.manage" />}>
            <Route path="/structure" element={<div>Structure page</div>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('route guards', () => {
  it('redirects a signed-out visitor to the login page', () => {
    auth.current = { user: null, loading: false, can: () => false };
    renderAt('/projects');
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('shows a loading state, not the login page, while the session is being restored', () => {
    auth.current = { user: null, loading: true, can: () => false };
    renderAt('/projects');
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('lets a signed-in user through', () => {
    signedIn(employee);
    renderAt('/projects');
    expect(screen.getByText('Projects page')).toBeInTheDocument();
  });

  it('sends someone without the capability to their own home page', () => {
    signedIn(employee);
    renderAt('/reports');
    expect(screen.getByText('My tasks page')).toBeInTheDocument();
    expect(screen.queryByText('Reports page')).not.toBeInTheDocument();
  });

  it('reports are open to the roles that hold reports.view and closed to the rest', () => {
    const allowed = [manager, teamLeader, departmentHead, management];
    const denied = [employee, hrAdmin, systemAdmin];
    for (const user of allowed) {
      signedIn(user);
      const { unmount } = renderAt('/reports');
      expect(screen.getByText('Reports page'), user.role).toBeInTheDocument();
      unmount();
    }
    for (const user of denied) {
      signedIn(user);
      const { unmount } = renderAt('/reports');
      expect(screen.queryByText('Reports page'), user.role).not.toBeInTheDocument();
      unmount();
    }
  });

  it('the organisation screen is only for those who manage the structure', () => {
    for (const [user, open] of [[hrAdmin, true], [systemAdmin, true], [manager, false], [management, false], [teamLeader, false], [employee, false]]) {
      signedIn(user);
      const { unmount } = renderAt('/structure');
      expect(Boolean(screen.queryByText('Structure page')), user.role).toBe(open);
      unmount();
    }
  });

  it('lands each role on its own home page', () => {
    for (const user of [employee, manager, teamLeader, departmentHead, hrAdmin, management, systemAdmin]) {
      signedIn(user);
      const { container, unmount } = renderAt('/');
      const expected = landingFor(user);
      const page = {
        '/my-tasks': 'My tasks page', '/projects': 'Projects page', '/employees': 'Employees page',
        '/team': 'Team dashboard page', '/department': 'Department dashboard page', '/dashboard': 'Company dashboard page',
        '/admin': 'Administration page',
      }[expected];
      expect(container.textContent, `${user.role} -> ${expected}`).toContain(page);
      unmount();
    }
  });
});
