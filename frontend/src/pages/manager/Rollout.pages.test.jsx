import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Employees from './Employees';
import ProjectDetail from './ProjectDetail';
import { person, authOf, hrAdmin, systemAdmin, manager, makeProject, makeTask } from '../../test/fixtures';

// The screens as the client sees them in batch 1: the refinements (categories,
// photographs, overtime, project extras) and later roles are not shown, and are
// not sent to the server either.
const mocks = vi.hoisted(() => ({
  persona: null,
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  resetPassword: vi.fn(),
  getPhoto: vi.fn(),
  setPhoto: vi.fn(),
  listDepartments: vi.fn(),
  getProject: vi.fn(),
  listProjectTasks: vi.fn(),
  updateProject: vi.fn(),
  assignTask: vi.fn(),
  listAssignees: vi.fn(),
  listProjectManagers: vi.fn(),
  listTeamLeaders: vi.fn(),
  listCategories: vi.fn(),
  updateTask: vi.fn(),
  listTaskTimeLogs: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/employees', () => ({
  listEmployees: mocks.listEmployees, createEmployee: mocks.createEmployee, updateEmployee: mocks.updateEmployee,
  resetPassword: mocks.resetPassword, getPhoto: mocks.getPhoto, setPhoto: mocks.setPhoto,
}));
vi.mock('../../api/departments', () => ({ listDepartments: mocks.listDepartments }));
vi.mock('../../api/projects', () => ({
  getProject: mocks.getProject, listProjectTasks: mocks.listProjectTasks, updateProject: mocks.updateProject, assignTask: mocks.assignTask,
  listAssignees: mocks.listAssignees, listProjectManagers: mocks.listProjectManagers, listTeamLeaders: mocks.listTeamLeaders,
}));
vi.mock('../../api/tasks', () => ({ updateTask: mocks.updateTask, listTaskTimeLogs: mocks.listTaskTimeLogs, listCategories: mocks.listCategories }));
vi.mock('../../api/timelogs', () => ({ adjustSession: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authOf(mocks.persona) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const batch1 = {
  batch: 1,
  roles: ['employee', 'project_manager', 'hr_admin', 'system_admin'],
  features: { manHours: false, summaries: false, categories: false, photos: false, overtime: false, currentProjects: false, projectExtras: false, noAllocation: false, email: false },
};
const inBatch1 = (user) => ({ ...user, rollout: batch1 });

const drawerFor = (title) => screen.getByText(title, { selector: 'h3' }).closest('.drawer-panel');

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  mocks.listDepartments.mockResolvedValue([
    { department_id: 1, name: 'Piping', subDepartments: [{ id: 1, name: 'Input Study' }], teams: [] },
  ]);
});

// ===================================================================== employees
describe('Employees in batch 1', () => {
  const people = () => [
    person({ id: 4, name: 'Ahmed Khalil', email: 'a@test.local', role: 'employee', designation: 'Engineer', department: 'Piping', departmentId: 1 }),
    person({ id: 20, name: 'Hilal Al-Siyabi', email: 'h@test.local', role: 'team_leader', designation: 'Team Leader', department: 'Piping', departmentId: 1 }),
  ];

  async function renderEmployees(user) {
    mocks.persona = inBatch1(user);
    mocks.listEmployees.mockResolvedValue(people());
    render(<Employees />);
    await screen.findByText('Directory');
  }

  it('has no overtime or photograph controls when editing someone', async () => {
    await renderEmployees(hrAdmin);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
    const drawer = drawerFor('Ahmed Khalil');
    expect(within(drawer).queryByLabelText('Eligible for overtime')).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Photograph file')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Add photograph')).not.toBeInTheDocument();
    expect(mocks.getPhoto).not.toHaveBeenCalled();
  });

  it('has no overtime box when adding someone', async () => {
    await renderEmployees(hrAdmin);
    await userEvent.click(screen.getByRole('button', { name: '+ New Employee' }));
    expect(within(drawerFor('New Employee')).queryByLabelText('Eligible for overtime')).not.toBeInTheDocument();
  });

  it('does not send overtime to the server when saving, or when adding', async () => {
    mocks.updateEmployee.mockResolvedValue(people()[0]);
    await renderEmployees(hrAdmin);
    await userEvent.click(screen.getByRole('button', { name: 'Edit Ahmed Khalil' }));
    await userEvent.click(within(drawerFor('Ahmed Khalil')).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateEmployee).toHaveBeenCalled());
    expect(mocks.updateEmployee.mock.calls[0][1]).not.toHaveProperty('overtimeEligible');
  });

  it('only offers the roles that are open', async () => {
    await renderEmployees(systemAdmin);
    await userEvent.click(screen.getByRole('button', { name: '+ New Employee' }));
    const role = within(drawerFor('New Employee')).getAllByRole('combobox')[0];
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Employee', 'Project Manager', 'HR / Admin', 'System Administrator']);
  });

  it('HR is offered only the open everyday roles', async () => {
    await renderEmployees(hrAdmin);
    await userEvent.click(screen.getByRole('button', { name: '+ New Employee' }));
    const role = within(drawerFor('New Employee')).getAllByRole('combobox')[0];
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Employee', 'Project Manager']);
  });

  it('filters the list by the open roles only', async () => {
    await renderEmployees(hrAdmin);
    const filter = screen.getByLabelText('Role');
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Roles', 'Employee', 'Project Manager', 'HR / Admin', 'System Administrator']);
  });

  it('still shows someone whose role is not open, without losing their role when editing', async () => {
    await renderEmployees(systemAdmin);
    expect(screen.getByText('Hilal Al-Siyabi')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Hilal Al-Siyabi' }));
    const role = within(drawerFor('Hilal Al-Siyabi')).getByLabelText('Role');
    expect(role).toHaveValue('team_leader');
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Employee', 'Team Leader', 'Project Manager', 'HR / Admin', 'System Administrator']);
  });
});

// ===================================================================== project screen
describe('Project screen in batch 1', () => {
  const batch1Project = () => makeProject({ assignedEmployees: [{ id: 4, name: 'Ahmed Khalil', designation: 'Engineer', taskCount: 1, plannedHours: 10, consumedHours: 2 }] });

  function renderProject() {
    mocks.persona = inBatch1(manager);
    mocks.getProject.mockResolvedValue(batch1Project());
    mocks.listProjectTasks.mockResolvedValue([makeTask({ id: 10, taskName: 'Stress calc' })]);
    mocks.listAssignees.mockResolvedValue([{ id: 4, name: 'Ahmed Khalil', designation: 'Engineer', departmentId: 1 }]);
    mocks.listProjectManagers.mockResolvedValue([{ id: 1, name: 'Manager One', role: 'project_manager' }]);
    mocks.listTaskTimeLogs.mockResolvedValue([]);
    mocks.updateProject.mockResolvedValue(batch1Project());
    mocks.updateTask.mockResolvedValue(makeTask({ id: 10, taskName: 'Stress calc' }));
    return render(
      <MemoryRouter initialEntries={['/projects/1']}>
        <Routes><Route path="/projects/:id" element={<ProjectDetail />} /></Routes>
      </MemoryRouter>
    );
  }

  it('does not ask the server for categories or team leaders', async () => {
    renderProject();
    await screen.findByText('Stress calc');
    expect(mocks.listCategories).not.toHaveBeenCalled();
    expect(mocks.listTeamLeaders).not.toHaveBeenCalled();
  });

  it('shows hours and allocation, but no completion, team leader or category', async () => {
    renderProject();
    await screen.findByText('Stress calc');
    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByText('2h used of 10h')).toBeInTheDocument();
    expect(screen.queryByText(/Work completed/)).not.toBeInTheDocument();
    expect(screen.queryByText('Team Leader')).not.toBeInTheDocument();
    expect(screen.queryByText('Agreed Fee')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Category' })).not.toBeInTheDocument();
  });

  it('has no category choice when assigning or editing a task', async () => {
    renderProject();
    await userEvent.click(await screen.findByRole('button', { name: '+ Assign Task' }));
    expect(within(screen.getByText('Assign Task', { selector: 'h3' }).closest('.drawer-panel')).queryByLabelText('Category')).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByText('Assign Task', { selector: 'h3' }).closest('.drawer-panel')).getByRole('button', { name: 'Cancel' }));

    await userEvent.click((await screen.findByText('Stress calc')).closest('tr'));
    const dialog = document.querySelector('.modal-panel');
    expect(within(dialog).queryByLabelText('Category')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateTask).toHaveBeenCalled());
    expect(mocks.updateTask.mock.calls[0][1]).not.toHaveProperty('category');
  });

  it('has no team leader, fee or completion fields when editing the project, and sends none', async () => {
    renderProject();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
    const drawer = document.querySelector('.drawer-panel');
    expect(within(drawer).queryByLabelText('Team leader')).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Agreed fee')).not.toBeInTheDocument();
    expect(within(drawer).queryByLabelText('Project completion')).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalled());
    const payload = mocks.updateProject.mock.calls[0][1];
    for (const key of ['teamLeaderId', 'agreedFee', 'completionOverridePercent']) expect(payload).not.toHaveProperty(key);
  });
});
