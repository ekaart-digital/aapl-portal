import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDetail from './ProjectDetail';
import { manager, makeProject, makeTask } from '../../test/fixtures';

// Project master fields (team leader, agreed fee, the manager's own completion
// figure), task categories, and who has work on the project.
const mocks = vi.hoisted(() => ({
  user: null,
  getProject: vi.fn(),
  listProjectTasks: vi.fn(),
  updateProject: vi.fn(),
  assignTask: vi.fn(),
  listDepartments: vi.fn(),
  listAssignees: vi.fn(),
  listProjectManagers: vi.fn(),
  listTeamLeaders: vi.fn(),
  listCategories: vi.fn(),
  updateTask: vi.fn(),
  listTaskTimeLogs: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/projects', () => ({
  getProject: mocks.getProject,
  listProjectTasks: mocks.listProjectTasks,
  updateProject: mocks.updateProject,
  assignTask: mocks.assignTask,
  listAssignees: mocks.listAssignees,
  listProjectManagers: mocks.listProjectManagers,
  listTeamLeaders: mocks.listTeamLeaders,
}));
vi.mock('../../api/departments', () => ({ listDepartments: mocks.listDepartments }));
vi.mock('../../api/tasks', () => ({ updateTask: mocks.updateTask, listTaskTimeLogs: mocks.listTaskTimeLogs, listCategories: mocks.listCategories }));
vi.mock('../../api/timelogs', () => ({ adjustSession: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

function renderPage(user = manager) {
  mocks.user = user;
  return render(
    <MemoryRouter initialEntries={['/projects/1']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/projects" element={<div>Projects list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const detail = (over = {}) => makeProject({
  teamLeaderId: null, teamLeaderName: null, agreedFee: null, completionOverridePercent: null,
  completionPercent: 55, completionIsManual: false, projectedFinalManHours: 120,
  assignedEmployees: [
    { id: 4, name: 'Ahmed Khalil', designation: 'Engineer', taskCount: 2, plannedHours: 30, consumedHours: 12.5 },
    { id: 5, name: 'Vivek Rao', designation: 'Engineer', taskCount: 1, plannedHours: 10, consumedHours: 0 },
  ],
  ...over,
});

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  mocks.getProject.mockResolvedValue(detail());
  mocks.listProjectTasks.mockResolvedValue([makeTask({ id: 10, taskName: 'Stress calc', category: 'Calculation' }), makeTask({ id: 11, taskName: 'Plain task', category: null })]);
  mocks.listDepartments.mockResolvedValue([{ department_id: 1, name: 'Piping', subDepartments: [{ id: 1, name: 'Input Study' }] }]);
  mocks.listAssignees.mockResolvedValue([{ id: 4, name: 'Ahmed Khalil', designation: 'Engineer', departmentId: 1 }]);
  mocks.listProjectManagers.mockResolvedValue([{ id: 1, name: 'Manager One', role: 'project_manager' }]);
  mocks.listTeamLeaders.mockResolvedValue([{ id: 20, name: 'Hilal Al-Siyabi', department: 'Piping' }, { id: 22, name: 'Noora Al-Farsi', department: 'Structural' }]);
  mocks.listCategories.mockResolvedValue(['Calculation', 'Modelling', 'Review']);
  mocks.listTaskTimeLogs.mockResolvedValue([]);
});

describe('project overview', () => {
  it('shows the completion figure, the projection, the team leader and the fee', async () => {
    mocks.getProject.mockResolvedValue(detail({ teamLeaderId: 20, teamLeaderName: 'Hilal Al-Siyabi', agreedFee: 125000 }));
    renderPage();
    await screen.findByText('Work completed');
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText(/finishes at about 120 MH/)).toBeInTheDocument();
    expect(screen.getByText('Hilal Al-Siyabi', { selector: '.v' })).toBeInTheDocument();
    expect(screen.getByText('125,000')).toBeInTheDocument();
  });

  it('says when the completion figure was entered by the project manager', async () => {
    mocks.getProject.mockResolvedValue(detail({ completionPercent: 40, completionIsManual: true, completionOverridePercent: 40 }));
    renderPage();
    expect(await screen.findByText('Work completed (set by the project manager)')).toBeInTheDocument();
  });

  it('hides the agreed fee from people who are not sent it', async () => {
    const { agreedFee, ...withoutFee } = detail();
    mocks.getProject.mockResolvedValue({ ...withoutFee, permissions: { edit: false, allocate: true } });
    renderPage();
    await screen.findByText('Work completed');
    expect(screen.queryByText('Agreed Fee')).not.toBeInTheDocument();
  });

  it('lists who has work on the project with planned and used hours', async () => {
    renderPage();
    expect(await screen.findByText('12.5h used of 30h')).toBeInTheDocument();
    expect(screen.getByText('0h used of 10h')).toBeInTheDocument();
  });

  it('shows each task’s category', async () => {
    renderPage();
    const row = (await screen.findByText('Stress calc')).closest('tr');
    expect(within(row).getByText('Calculation')).toBeInTheDocument();
    expect(within(screen.getByText('Plain task').closest('tr')).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('task categories', () => {
  it('sends the chosen category when a task is assigned', async () => {
    mocks.assignTask.mockResolvedValue(makeTask({ id: 12, taskName: 'Drawing set', category: 'Review' }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '+ Assign Task' }));
    const drawer = screen.getByText('Assign Task', { selector: 'h3' }).closest('.drawer-panel');
    const [department, subDepartment, category, employee] = within(drawer).getAllByRole('combobox');
    expect(within(category).getAllByRole('option').map((o) => o.textContent)).toEqual(['No category', 'Calculation', 'Modelling', 'Review']);
    await userEvent.selectOptions(department, '1');
    await userEvent.selectOptions(subDepartment, '1');
    await userEvent.type(within(drawer).getByPlaceholderText(/Pipe stress analysis/), 'Drawing set');
    await userEvent.selectOptions(category, 'Review');
    await userEvent.selectOptions(employee, '4');
    await userEvent.type(within(drawer).getByRole('spinbutton'), '8');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Assign Task' }));
    await waitFor(() => expect(mocks.assignTask).toHaveBeenCalledWith('1', expect.objectContaining({ taskName: 'Drawing set', category: 'Review', employeeId: 4 })));
  });

  it('changes a task’s category from the task dialog', async () => {
    mocks.updateTask.mockResolvedValue(makeTask({ id: 10, taskName: 'Stress calc', category: 'Review' }));
    renderPage();
    await userEvent.click((await screen.findByText('Stress calc')).closest('tr'));
    const dialog = document.querySelector('.modal-panel');
    const category = within(dialog).getByLabelText('Category');
    expect(category).toHaveValue('Calculation');
    await userEvent.selectOptions(category, 'Review');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ category: 'Review' })));
  });
});

describe('editing the master fields', () => {
  it('sets a team leader, a fee and an own completion figure', async () => {
    mocks.updateProject.mockResolvedValue(detail({ teamLeaderId: 20 }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
    const drawer = document.querySelector('.drawer-panel');
    const leader = within(drawer).getByLabelText('Team leader');
    expect(within(leader).getAllByRole('option').map((o) => o.textContent)).toEqual(['No team leader', 'Hilal Al-Siyabi — Piping', 'Noora Al-Farsi — Structural']);
    await userEvent.selectOptions(leader, '20');
    await userEvent.type(within(drawer).getByLabelText('Agreed fee'), '90000');
    await userEvent.type(within(drawer).getByLabelText('Project completion'), '40');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalled());
    expect(mocks.updateProject.mock.calls[0][1]).toMatchObject({ teamLeaderId: 20, agreedFee: 90000, completionOverridePercent: 40 });
  });

  it('leaves the fields out when untouched, and clears them when emptied', async () => {
    const populated = detail({ teamLeaderId: 20, teamLeaderName: 'Hilal Al-Siyabi', agreedFee: 5000, completionOverridePercent: 30, completionPercent: 30, completionIsManual: true });
    mocks.getProject.mockResolvedValue(populated);
    mocks.updateProject.mockResolvedValueOnce(populated).mockResolvedValueOnce(detail());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
    let drawer = document.querySelector('.drawer-panel');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledTimes(1));
    for (const key of ['teamLeaderId', 'agreedFee', 'completionOverridePercent']) expect(mocks.updateProject.mock.calls[0][1]).not.toHaveProperty(key);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
    drawer = document.querySelector('.drawer-panel');
    await userEvent.clear(within(drawer).getByLabelText('Project completion'));
    await userEvent.selectOptions(within(drawer).getByLabelText('Team leader'), '');
    await userEvent.clear(within(drawer).getByLabelText('Agreed fee'));
    await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledTimes(2));
    expect(mocks.updateProject.mock.calls[1][1]).toMatchObject({ teamLeaderId: null, agreedFee: null, completionOverridePercent: null });
  });

  it('has no fee field when the server did not send a fee', async () => {
    const { agreedFee, ...noFee } = detail();
    mocks.getProject.mockResolvedValue(noFee);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
    expect(within(document.querySelector('.drawer-panel')).queryByLabelText('Agreed fee')).not.toBeInTheDocument();
  });
});
