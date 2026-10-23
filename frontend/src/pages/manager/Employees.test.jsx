import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Employees from './Employees';
import { person, authOf, hrAdmin, systemAdmin, teamLeader, management } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  persona: null,
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  resetPassword: vi.fn(),
  listDepartments: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/employees', () => ({
  listEmployees: mocks.listEmployees,
  createEmployee: mocks.createEmployee,
  updateEmployee: mocks.updateEmployee,
  resetPassword: mocks.resetPassword,
}));
vi.mock('../../api/departments', () => ({ listDepartments: mocks.listDepartments }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authOf(mocks.persona) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const tl = { id: 20, name: 'Hilal Al-Siyabi' };
const head = { id: 21, name: 'Khalid Al-Rawahi' };

// The people the signed-in user is allowed to see (the server decides which).
const people = [
  person({ id: 23, name: 'Hamad Al-Said', email: 'hamad@test.local', role: 'management', designation: 'Managing Director' }),
  person({ id: 22, name: 'Layan Al-Mahrouqi', email: 'layan@test.local', role: 'hr_admin', designation: 'HR Officer' }),
  person({ id: 1, name: 'Manager One', email: 'm1@test.local', role: 'project_manager', designation: 'Project Manager' }),
  person({ id: 4, name: 'Ahmed Khalil', email: 'ahmed@test.local', role: 'employee', designation: 'Sr. Piping Engineer', department: 'Piping', departmentId: 1, team: 'Piping Team A', teamId: 5, reportsToTeamLeader: tl, reportsToDepartmentHead: head, dateOfJoining: '2024-03-01', mobileNumber: '12345678' }),
  person({ id: 8, name: 'Daniel Costa', email: 'daniel@test.local', role: 'employee', designation: 'Structural Engineer', department: 'Structural', departmentId: 2, team: null, reportsToDepartmentHead: { id: 25, name: 'Maryam Al-Balushi' } }),
];

const departments = [
  { department_id: 1, name: 'Piping', subDepartments: [], teams: [{ id: 5, name: 'Piping Team A' }, { id: 6, name: 'Piping Night' }] },
  { department_id: 2, name: 'Structural', subDepartments: [], teams: [{ id: 7, name: 'Structural Team A' }] },
];

const drawerFor = (title) => screen.getByText(title, { selector: 'h3' }).closest('.drawer-panel');

async function renderPage(persona = hrAdmin) {
  mocks.persona = persona;
  render(<Employees />);
  await screen.findByText('Directory');
}

describe('Employees', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
    mocks.listEmployees.mockResolvedValue(people);
    mocks.listDepartments.mockResolvedValue(departments);
  });

  describe('the directory', () => {
    it('shows each person with their code, role, department, team and who they report to', async () => {
      await renderPage();
      const row = screen.getByText('Ahmed Khalil').closest('tr');
      expect(within(row).getByText('EMP-004')).toBeInTheDocument();
      expect(within(row).getByText('Employee')).toBeInTheDocument();
      expect(within(row).getByText('Piping')).toBeInTheDocument();
      expect(within(row).getByText('Piping Team A')).toBeInTheDocument();
      expect(within(row).getByText('Hilal Al-Siyabi')).toBeInTheDocument();

      const pm = screen.getByText('Manager One').closest('tr');
      expect(within(pm).getByText('Project Manager', { selector: '.badge' })).toBeInTheDocument();
      expect(screen.getByText('5 of 5 people')).toBeInTheDocument();
    });

    it('searches by name, Employee ID and email', async () => {
      await renderPage();
      const search = screen.getByPlaceholderText(/search by name, id or email/i);

      await userEvent.type(search, 'daniel');
      expect(screen.getByText('1 of 5 people')).toBeInTheDocument();

      await userEvent.clear(search);
      await userEvent.type(search, 'emp-004');
      expect(screen.getByText('Ahmed Khalil')).toBeInTheDocument();
      expect(screen.queryByText('Daniel Costa')).not.toBeInTheDocument();

      await userEvent.clear(search);
      await userEvent.type(search, 'm1@test');
      expect(screen.getByText('1 of 5 people')).toBeInTheDocument();
    });

    it('filters by department, including people with none, and by role', async () => {
      await renderPage();
      await userEvent.selectOptions(screen.getByLabelText('Department'), 'Structural');
      expect(screen.getByText('1 of 5 people')).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Department'), 'No department');
      expect(screen.getByText('3 of 5 people')).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText('Department'), 'All');
      await userEvent.selectOptions(screen.getByLabelText('Role'), 'hr_admin');
      expect(screen.getByText('1 of 5 people')).toBeInTheDocument();
      expect(screen.getByText('Layan Al-Mahrouqi')).toBeInTheDocument();
    });

    it('offers a retry when the directory cannot be loaded', async () => {
      mocks.listEmployees.mockRejectedValueOnce(new Error('Could not reach the server.'));
      mocks.persona = hrAdmin;
      render(<Employees />);
      expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Directory')).toBeInTheDocument();
    });
  });

  describe('people who can only look (team leaders, department heads, project managers, management)', () => {
    it('see a read-only directory with no way to add or change anyone', async () => {
      for (const viewer of [teamLeader, management]) {
        await renderPage(viewer);
        expect(screen.queryByRole('button', { name: '+ New Employee' })).not.toBeInTheDocument();
        expect(screen.getByText('The people you are responsible for')).toBeInTheDocument();
        document.body.innerHTML = '';
      }
    });

    it('can open a profile to see the master record, but not edit it', async () => {
      await renderPage(teamLeader);
      await userEvent.click(screen.getByText('Ahmed Khalil'));
      const drawer = drawerFor('Ahmed Khalil');

      expect(within(drawer).getByText('Team leader').nextSibling).toHaveTextContent('Hilal Al-Siyabi');
      expect(within(drawer).getByText('Department head').nextSibling).toHaveTextContent('Khalid Al-Rawahi');
      expect(within(drawer).getByText('Date of joining').nextSibling).toHaveTextContent('2024-03-01');
      expect(within(drawer).getByText('Mobile').nextSibling).toHaveTextContent('12345678');
      expect(within(drawer).queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
      expect(within(drawer).queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
      expect(drawer.querySelector('.drawer-foot')).toHaveTextContent('Close');
    });
  });

  describe('adding someone (HR/Admin and the System Administrator)', () => {
    async function openCreate(persona = hrAdmin) {
      await renderPage(persona);
      await userEvent.click(screen.getByRole('button', { name: '+ New Employee' }));
      return drawerFor('New Employee');
    }
    const fill = async (drawer, { name = 'New Hire', email = 'new@test.local', password = 'LongEnough1' } = {}) => {
      const [nameInput, , passwordInput] = drawer.querySelectorAll('input');
      await userEvent.type(nameInput, name);
      await userEvent.type(drawer.querySelector('input[type="email"]'), email);
      await userEvent.type(passwordInput, password);
    };

    it('HR can create the four everyday roles; the System Administrator can create all seven', async () => {
      let drawer = await openCreate(hrAdmin);
      const options = (d) => within(within(d).getByDisplayValue('Employee')).getAllByRole('option').map((o) => o.textContent);
      expect(options(drawer)).toEqual(['Employee', 'Team Leader', 'Department Head', 'Project Manager']);
      document.body.innerHTML = '';

      drawer = await openCreate(systemAdmin);
      expect(options(drawer)).toEqual(['Employee', 'Team Leader', 'Department Head', 'Project Manager', 'HR / Admin', 'Management', 'System Administrator']);
    });

    it('checks the required fields and that a department is chosen for roles that work in one', async () => {
      const drawer = await openCreate();
      const add = within(drawer).getByRole('button', { name: 'Add Employee' });

      await userEvent.click(add);
      expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/name, email and an initial password/i));

      await fill(drawer);
      await userEvent.click(add);
      expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/select a department for a employee/i));
      expect(mocks.createEmployee).not.toHaveBeenCalled();
    });

    it('creates an employee with department, team and master details, and shows the new ID', async () => {
      mocks.createEmployee.mockResolvedValue(person({ id: 40, name: 'New Hire', email: 'new@test.local', department: 'Piping', departmentId: 1, team: 'Piping Team A', teamId: 5 }));
      const drawer = await openCreate();
      await fill(drawer);

      await userEvent.selectOptions(within(drawer).getByLabelText('Department for the new employee'), 'Piping');
      await userEvent.selectOptions(within(drawer).getByLabelText('Team for the new employee'), 'Piping Team A');
      const [designation] = drawer.querySelectorAll('input:not([type])').length ? [drawer.querySelector('input[placeholder="e.g. Piping Engineer"]')] : [];
      await userEvent.type(designation, 'Piping Engineer');
      await userEvent.type(drawer.querySelector('input[type="date"]'), '2026-03-01');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Add Employee' }));

      await waitFor(() => expect(mocks.createEmployee).toHaveBeenCalledWith(expect.objectContaining({
        name: 'New Hire', email: 'new@test.local', role: 'employee', departmentId: 1, teamId: 5,
        designation: 'Piping Engineer', dateOfJoining: '2026-03-01',
      })));
      expect(mocks.pushToast).toHaveBeenCalledWith('New Hire added. Employee ID: EMP-040');
      expect(await screen.findByText('EMP-040')).toBeInTheDocument();
    });

    it('only offers the teams of the chosen department', async () => {
      const drawer = await openCreate();
      const team = within(drawer).getByLabelText('Team for the new employee');
      expect(team).toBeDisabled();

      await userEvent.selectOptions(within(drawer).getByLabelText('Department for the new employee'), 'Structural');
      expect(within(team).getAllByRole('option').map((o) => o.textContent)).toEqual(['No team yet', 'Structural Team A']);

      await userEvent.selectOptions(within(drawer).getByLabelText('Department for the new employee'), 'Piping');
      expect(within(team).getAllByRole('option').map((o) => o.textContent)).toEqual(['No team yet', 'Piping Team A', 'Piping Night']);
    });

    it('a role with no discipline has no department to fill in', async () => {
      mocks.createEmployee.mockResolvedValue(person({ id: 41, name: 'Boss Two', role: 'project_manager' }));
      const drawer = await openCreate();
      await userEvent.selectOptions(within(drawer).getByDisplayValue('Employee'), 'project_manager');
      expect(within(drawer).getByLabelText('Department for the new employee')).toBeDisabled();
      expect(within(drawer).queryByLabelText('Team for the new employee')).not.toBeInTheDocument();

      await fill(drawer, { name: 'Boss Two', email: 'boss@test.local' });
      await userEvent.click(within(drawer).getByRole('button', { name: 'Add Employee' }));
      await waitFor(() => expect(mocks.createEmployee).toHaveBeenCalled());
      const sent = mocks.createEmployee.mock.calls[0][0];
      expect(sent.role).toBe('project_manager');
      expect(sent.departmentId).toBeUndefined();
      expect(sent.teamId).toBeUndefined();
    });

    it('a department head is created in a department but not in a team', async () => {
      mocks.createEmployee.mockResolvedValue(person({ id: 42, name: 'Head Three', role: 'department_head', department: 'Piping', departmentId: 1 }));
      const drawer = await openCreate();
      await userEvent.selectOptions(within(drawer).getByDisplayValue('Employee'), 'department_head');
      expect(within(drawer).queryByLabelText('Team for the new employee')).not.toBeInTheDocument();
      await fill(drawer, { name: 'Head Three', email: 'head3@test.local' });
      await userEvent.selectOptions(within(drawer).getByLabelText('Department for the new employee'), 'Piping');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Add Employee' }));

      await waitFor(() => expect(mocks.createEmployee).toHaveBeenCalled());
      const sent = mocks.createEmployee.mock.calls[0][0];
      expect(sent.departmentId).toBe(1);
      expect(sent.teamId).toBeUndefined();
    });

    it('shows the server\'s message when creating fails', async () => {
      mocks.createEmployee.mockRejectedValue(new Error('An employee with this email already exists.'));
      const drawer = await openCreate();
      await fill(drawer);
      await userEvent.selectOptions(within(drawer).getByLabelText('Department for the new employee'), 'Piping');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Add Employee' }));
      await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('An employee with this email already exists.'));
    });
  });

  describe('the Edit button on each row', () => {
    it('HR gets Edit for everyday accounts and View for the powerful ones', async () => {
      await renderPage(hrAdmin);
      expect(screen.getByRole('button', { name: 'Edit Ahmed Khalil' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Manager One' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View Hamad Al-Said' })).toBeInTheDocument(); // Management
      expect(screen.getByRole('button', { name: 'View Layan Al-Mahrouqi' })).toBeInTheDocument(); // HR
    });

    it('opens the same editable profile as clicking the row, once', async () => {
      await renderPage(hrAdmin);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
      const drawer = drawerFor('Ahmed Khalil');
      expect(within(drawer).getByDisplayValue('Sr. Piping Engineer')).toBeEnabled();
      expect(within(drawer).getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    });

    it('the System Administrator can edit everyone', async () => {
      await renderPage(systemAdmin);
      expect(screen.getByRole('button', { name: 'Edit Hamad Al-Said' })).toBeInTheDocument();
    });

    it('people who can only look get View, never Edit', async () => {
      await renderPage(teamLeader);
      expect(screen.getByRole('button', { name: 'View Ahmed Khalil' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    });
  });

  describe('changing someone', () => {
    it('opens prefilled and saves only what changed', async () => {
      mocks.updateEmployee.mockResolvedValue({ ...people[3], designation: 'Senior Engineer' });
      await renderPage();
      await userEvent.click(screen.getByText('Ahmed Khalil'));
      const drawer = drawerFor('Ahmed Khalil');

      const designation = within(drawer).getByDisplayValue('Sr. Piping Engineer');
      await userEvent.clear(designation);
      await userEvent.type(designation, 'Senior Engineer');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalled());
      const [id, payload] = mocks.updateEmployee.mock.calls[0];
      expect(id).toBe(4);
      expect(payload.designation).toBe('Senior Engineer');
      expect(payload).not.toHaveProperty('role');
      expect(payload).not.toHaveProperty('departmentId');
      expect(payload).not.toHaveProperty('teamId');
    });

    it('moving to another department clears the team, so both are sent', async () => {
      mocks.updateEmployee.mockResolvedValue({ ...people[3], department: 'Structural', departmentId: 2, team: null, teamId: null });
      await renderPage();
      await userEvent.click(screen.getByText('Ahmed Khalil'));
      const drawer = drawerFor('Ahmed Khalil');

      await userEvent.selectOptions(within(drawer).getByLabelText('Department'), 'Structural');
      expect(within(drawer).getByLabelText('Team')).toHaveValue('');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalledWith(4, expect.objectContaining({ departmentId: 2, teamId: null })));
    });

    it('changes the team within a department, and can clear it', async () => {
      mocks.updateEmployee.mockResolvedValue({ ...people[3], team: 'Piping Night', teamId: 6 });
      await renderPage();
      await userEvent.click(screen.getByText('Ahmed Khalil'));
      const drawer = drawerFor('Ahmed Khalil');

      await userEvent.selectOptions(within(drawer).getByLabelText('Team'), 'Piping Night');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalledWith(4, expect.objectContaining({ teamId: 6 })));
      expect(mocks.updateEmployee.mock.calls[0][1]).not.toHaveProperty('departmentId');
    });

    it('deactivates an account and shows it as inactive', async () => {
      mocks.updateEmployee.mockResolvedValue({ ...people[4], status: 'inactive' });
      await renderPage();
      await userEvent.click(screen.getByText('Daniel Costa'));
      const drawer = drawerFor('Daniel Costa');
      await userEvent.selectOptions(within(drawer).getByLabelText('Account status'), 'inactive');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
      expect(await screen.findByText('Inactive')).toBeInTheDocument();
    });

    it('HR cannot change roles; only the System Administrator is offered the Role field', async () => {
      await renderPage(hrAdmin);
      await userEvent.click(screen.getByText('Ahmed Khalil'));
      expect(within(drawerFor('Ahmed Khalil')).queryByLabelText('Role')).not.toBeInTheDocument();
      document.body.innerHTML = '';

      mocks.updateEmployee.mockResolvedValue({ ...people[3], role: 'team_leader', roleLabel: 'Team Leader' });
      await renderPage(systemAdmin);
      await userEvent.click(screen.getByText('Ahmed Khalil'));
      const drawer = drawerFor('Ahmed Khalil');
      await userEvent.selectOptions(within(drawer).getByLabelText('Role'), 'team_leader');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalledWith(4, expect.objectContaining({ role: 'team_leader' })));
    });

    it('HR sees the powerful accounts as read-only, with the reason', async () => {
      await renderPage(hrAdmin);
      for (const name of ['Hamad Al-Said', 'Layan Al-Mahrouqi']) {
        await userEvent.click(screen.getByText(name));
        const drawer = drawerFor(name);
        expect(within(drawer).getByText(/only a system administrator can change this account/i)).toBeInTheDocument();
        expect(within(drawer).queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument();
        await userEvent.click(within(drawer.querySelector('.drawer-foot')).getByRole('button', { name: 'Close' }));
      }
    });

    it('the System Administrator can edit the powerful accounts', async () => {
      await renderPage(systemAdmin);
      await userEvent.click(screen.getByText('Hamad Al-Said'));
      expect(within(drawerFor('Hamad Al-Said')).getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    });

    it('you cannot deactivate or re-role yourself', async () => {
      mocks.listEmployees.mockResolvedValue([...people, systemAdmin]);
      await renderPage(systemAdmin);
      await userEvent.click(screen.getByText('Platform Administrator'));
      const drawer = drawerFor('Platform Administrator');
      expect(within(drawer).getByLabelText('Account status')).toBeDisabled();
      expect(within(drawer).queryByLabelText('Role')).not.toBeInTheDocument();
    });

    it('resets a password: rejects a weak one, then resets', async () => {
      mocks.resetPassword.mockResolvedValue({ ok: true });
      await renderPage();
      await userEvent.click(screen.getByText('Daniel Costa'));
      await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));

      const modal = screen.getByText(/reset password — daniel costa/i).closest('.modal-panel');
      const input = modal.querySelector('input[type="password"]');
      await userEvent.type(input, 'short');
      await userEvent.click(within(modal).getByRole('button', { name: 'Reset password' }));
      expect(mocks.resetPassword).not.toHaveBeenCalled();
      expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/letter and a number/i));

      await userEvent.clear(input);
      await userEvent.type(input, 'BrandNew123');
      await userEvent.click(within(modal).getByRole('button', { name: 'Reset password' }));
      await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith(8, 'BrandNew123'));
      expect(mocks.pushToast).toHaveBeenCalledWith('Password reset for Daniel Costa.');
    });

    it('shows the server\'s reason when a change is refused', async () => {
      mocks.updateEmployee.mockRejectedValue(new Error('Daniel Costa still has 2 open task(s). Reassign them first.'));
      await renderPage();
      await userEvent.click(screen.getByText('Daniel Costa'));
      const drawer = drawerFor('Daniel Costa');
      await userEvent.selectOptions(within(drawer).getByLabelText('Account status'), 'inactive');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Daniel Costa still has 2 open task(s). Reassign them first.'));
      expect(screen.getByText('Daniel Costa', { selector: 'h3' })).toBeInTheDocument();
    });
  });
});
