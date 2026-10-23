import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProjectDetail from './ProjectDetail';
import { manager, employee, departmentHead, makeProject, makeTask } from '../../test/fixtures';

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
  adjustSession: vi.fn(),
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
vi.mock('../../api/timelogs', () => ({ adjustSession: mocks.adjustSession }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const apiError = (status, message) => Object.assign(new Error(message), { status });

function renderPage(user) {
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

describe('ProjectDetail', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
    mocks.getProject.mockResolvedValue(makeProject());
    mocks.listProjectTasks.mockResolvedValue([makeTask({ id: 10, taskName: 'Pipe stress analysis' })]);
    mocks.listDepartments.mockResolvedValue([{ department_id: 1, name: 'Piping', subDepartments: [{ id: 1, name: 'Input Study' }] }]);
    mocks.listAssignees.mockResolvedValue([{ id: 4, name: 'Ahmed Khalil', designation: 'Sr. Piping Engineer', departmentId: 1 }]);
    mocks.listProjectManagers.mockResolvedValue([{ id: 1, name: 'Manager One', role: 'project_manager' }]);
    mocks.listTeamLeaders.mockResolvedValue([{ id: 20, name: 'Hilal Al-Siyabi', department: 'Piping' }]);
    mocks.listCategories.mockResolvedValue(['Calculation', 'Modelling']);
    mocks.listTaskTimeLogs.mockResolvedValue([]);
  });

  it('shows hours used, remaining and the task list', async () => {
    renderPage(manager);
    expect(await screen.findByText('Saria Refinery')).toBeInTheDocument();
    expect(screen.getByText('Remaining MH').nextSibling).toHaveTextContent('75');
    expect(screen.getByText('Pipe stress analysis')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('gives a manager the edit and assign controls', async () => {
    renderPage(manager);
    expect(await screen.findByRole('button', { name: 'Edit Project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Assign Task' })).toBeInTheDocument();
  });

  it('gives an employee a read-only view and does not load manager-only lists', async () => {
    mocks.getProject.mockResolvedValue(makeProject({ permissions: { edit: false, allocate: false } }));
    renderPage(employee);
    await screen.findByText('Saria Refinery');
    expect(screen.queryByRole('button', { name: 'Edit Project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Assign Task' })).not.toBeInTheDocument();
    expect(mocks.listAssignees).not.toHaveBeenCalled();
    expect(mocks.listProjectManagers).not.toHaveBeenCalled();
  });

  it('shows "not found" instead of an error when the project is missing or off-limits', async () => {
    for (const status of [403, 404]) {
      mocks.getProject.mockRejectedValue(apiError(status, 'nope'));
      mocks.listProjectTasks.mockRejectedValue(apiError(status, 'nope'));
      const { unmount } = renderPage(employee);
      expect(await screen.findByText('Project not found')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('offers a retry on a server error', async () => {
    mocks.getProject.mockRejectedValue(apiError(500, 'Internal server error'));
    renderPage(manager);
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('edit project saves only valid values and keeps the department list', async () => {
    // The real PATCH response has no `departments` key at all.
    const { departments, ...patched } = makeProject({ estimatedManHours: 120 });
    mocks.updateProject.mockResolvedValue(patched);
    renderPage(manager);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));

    const hours = screen.getByDisplayValue('100');
    await userEvent.clear(hours);
    await userEvent.type(hours, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mocks.updateProject).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/positive estimated man-hours/i));

    await userEvent.clear(hours);
    await userEvent.type(hours, '120');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('1', expect.objectContaining({ estimatedManHours: 120 })));
    expect(await screen.findByText('Piping', { selector: '.v' })).toBeInTheDocument();
  });

  it('clicking a task row lets a manager edit it', async () => {
    mocks.updateTask.mockResolvedValue(makeTask({ id: 10, taskName: 'Renamed task', allocatedHours: 30 }));
    renderPage(manager);
    await userEvent.click(await screen.findByText('Pipe stress analysis'));

    const name = screen.getByDisplayValue('Pipe stress analysis');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed task');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ taskName: 'Renamed task' })));
    expect(await screen.findByText('Renamed task')).toBeInTheDocument();
  });

  it('an employee clicking a task row opens nothing', async () => {
    mocks.getProject.mockResolvedValue(makeProject({ permissions: { edit: false, allocate: false } }));
    renderPage(employee);
    await userEvent.click(await screen.findByText('Pipe stress analysis'));
    expect(screen.queryByText('Edit Task')).not.toBeInTheDocument();
  });

  it('assign task needs every field and only offers the project’s departments', async () => {
    renderPage(manager);
    await userEvent.click(await screen.findByRole('button', { name: '+ Assign Task' }));
    const drawer = screen.getByText('Assign Task', { selector: 'h3' }).closest('.drawer-panel');

    await userEvent.click(within(drawer).getByRole('button', { name: 'Assign Task' }));
    expect(mocks.assignTask).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/please fill in/i));

    const [department] = within(drawer).getAllByRole('combobox');
    expect(within(department).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select department...', 'Piping']);
  });

  describe('time sessions on a task', () => {
    const sessions = [
      { id: 51, logDate: '2026-10-04', durationMinutes: 720, isOpen: false, autoStopped: true, needsReview: true, note: null, editedAt: null, editedByName: null },
      { id: 50, logDate: '2026-10-02', durationMinutes: 90, isOpen: false, autoStopped: false, needsReview: false, note: null, editedAt: null, editedByName: null },
      { id: 49, logDate: '2026-10-01', durationMinutes: 300, isOpen: false, autoStopped: true, needsReview: false, note: 'Left at 5pm', editedAt: '2026-10-02 09:00:00', editedByName: 'Manager One' },
      { id: 48, logDate: '2026-10-05', durationMinutes: null, isOpen: true, autoStopped: false, needsReview: false, note: null, editedAt: null, editedByName: null },
    ];

    async function openTask() {
      mocks.listTaskTimeLogs.mockResolvedValue(sessions);
      renderPage(manager);
      await userEvent.click(await screen.findByText('Pipe stress analysis'));
      return screen.findByTestId('session-list');
    }

    it('lists the sessions with their review and adjustment status', async () => {
      const list = await openTask();
      expect(mocks.listTaskTimeLogs).toHaveBeenCalledWith(10);
      expect(within(list).getByText('Auto-stopped · needs review')).toBeInTheDocument();
      expect(within(list).getByText('Adjusted by Manager One')).toBeInTheDocument();
      expect(within(list).getByText('Left at 5pm')).toBeInTheDocument();
      expect(within(list).getByText(/2026-10-04 · 12h 00m/)).toBeInTheDocument();
      expect(within(list).getByText(/2026-10-05 · running/)).toBeInTheDocument();
    });

    it('only finished sessions can be adjusted', async () => {
      const list = await openTask();
      expect(within(list).getAllByRole('button', { name: 'Adjust' })).toHaveLength(3);
    });

    it('adjusting a session saves it and refreshes the project hours', async () => {
      mocks.adjustSession.mockResolvedValue({ ...sessions[0], durationMinutes: 480, needsReview: false, editedAt: 'now', editedByName: 'Manager One', note: 'Confirmed' });
      const list = await openTask();
      mocks.getProject.mockClear();

      await userEvent.click(within(list).getAllByRole('button', { name: 'Adjust' })[0]);
      const dialog = screen.getByText('Adjust session').closest('.modal-panel');
      const [hours] = within(dialog).getAllByRole('spinbutton');
      await userEvent.clear(hours);
      await userEvent.type(hours, '8');
      await userEvent.type(within(dialog).getByPlaceholderText(/confirmed with employee/i), 'Confirmed');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(mocks.adjustSession).toHaveBeenCalledWith(51, 480, 'Confirmed'));
      await waitFor(() => expect(mocks.getProject).toHaveBeenCalled());
      expect(await within(screen.getByTestId('session-list')).findByText(/2026-10-04 · 8h 00m/)).toBeInTheDocument();
    });

    it('says so when nothing has been logged yet', async () => {
      mocks.listTaskTimeLogs.mockResolvedValue([]);
      renderPage(manager);
      await userEvent.click(await screen.findByText('Pipe stress analysis'));
      expect(await screen.findByText('No time logged yet.')).toBeInTheDocument();
    });
  });
});

describe('ProjectDetail — reassigning and project setup', () => {
  const pipingB = { ...employee, id: 5, name: 'Vivek Rao', designation: 'Piping Engineer' };
  const structural = { ...employee, id: 8, name: 'Daniel Costa', department: 'Structural', departmentId: 2 };
  const allDepartments = [
    { department_id: 1, name: 'Piping', subDepartments: [{ id: 1, name: 'Input Study' }] },
    { department_id: 2, name: 'Structural', subDepartments: [{ id: 2, name: 'Modelling' }] },
    { department_id: 3, name: 'ESP', subDepartments: [{ id: 3, name: 'Calculations' }] },
  ];

  beforeEach(() => {
    Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
    mocks.getProject.mockResolvedValue(makeProject({ departments: [{ id: 1, name: 'Piping' }, { id: 2, name: 'Structural' }] }));
    mocks.listProjectTasks.mockResolvedValue([makeTask({ id: 10, taskName: 'Pipe stress analysis', departmentId: 1 })]);
    mocks.listDepartments.mockResolvedValue(allDepartments);
    // The server already limits these to people the signed-in user may use.
    mocks.listAssignees.mockResolvedValue([
      { id: 4, name: 'Ahmed Khalil', designation: 'Sr. Piping Engineer', departmentId: 1 },
      { id: 5, name: 'Vivek Rao', designation: 'Piping Engineer', departmentId: 1 },
      { id: 8, name: 'Daniel Costa', designation: 'Structural Engineer', departmentId: 2 },
    ]);
    mocks.listProjectManagers.mockResolvedValue([
      { id: 1, name: 'Manager One', role: 'project_manager' },
      { id: 2, name: 'Second Manager', role: 'project_manager' },
    ]);
    mocks.listTeamLeaders.mockResolvedValue([{ id: 20, name: 'Hilal Al-Siyabi', department: 'Piping' }]);
    mocks.listCategories.mockResolvedValue(['Calculation', 'Modelling']);
    mocks.listTaskTimeLogs.mockResolvedValue([]);
  });

  async function openTaskDialog() {
    renderPage(manager);
    await userEvent.click(await screen.findByText('Pipe stress analysis'));
    return screen.getByLabelText ? screen.getByText('Edit Task').closest('.modal-panel') : null;
  }

  describe('reassigning a task', () => {
    it('offers only people of the task’s own department', async () => {
      const dialog = await openTaskDialog();
      const select = within(dialog).getByDisplayValue(/Ahmed Khalil/);
      const names = within(select).getAllByRole('option').map((o) => o.textContent);
      expect(names.join('|')).toContain('Ahmed Khalil');
      expect(names.join('|')).toContain('Vivek Rao');
      expect(names.join('|')).not.toContain('Daniel Costa');
    });

    it('moves the task to the chosen employee and explains what happens to logged time', async () => {
      mocks.updateTask.mockResolvedValue(makeTask({ id: 10, employeeId: 5, employeeName: 'Vivek Rao', taskName: 'Pipe stress analysis' }));
      const dialog = await openTaskDialog();
      expect(within(dialog).queryByText(/time already logged stays/i)).not.toBeInTheDocument();

      await userEvent.selectOptions(within(dialog).getByDisplayValue(/Ahmed Khalil/), '5');
      expect(within(dialog).getByText(/time already logged stays with ahmed khalil/i)).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ employeeId: 5 })));
      expect(await screen.findByText('Vivek Rao', { selector: 'td' })).toBeInTheDocument();
    });

    it('does not send an assignee when it was not changed', async () => {
      mocks.updateTask.mockResolvedValue(makeTask({ id: 10, allocatedHours: 30 }));
      const dialog = await openTaskDialog();
      const hours = within(dialog).getByDisplayValue('10');
      await userEvent.clear(hours);
      await userEvent.type(hours, '30');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateTask).toHaveBeenCalled());
      expect(mocks.updateTask.mock.calls[0][1]).not.toHaveProperty('employeeId');
    });

    it('shows the server’s reason and keeps the dialog open when a task cannot be moved', async () => {
      mocks.updateTask.mockRejectedValue(new Error('This task has a running timer. Ask the current assignee to stop it before reassigning.'));
      const dialog = await openTaskDialog();
      await userEvent.selectOptions(within(dialog).getByDisplayValue(/Ahmed Khalil/), '5');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/running timer/i)));
      expect(screen.getByText('Edit Task')).toBeInTheDocument();
    });
  });

  describe('editing project departments and manager', () => {
    async function openProjectEditor() {
      renderPage(manager);
      await userEvent.click(await screen.findByRole('button', { name: 'Edit Project' }));
      return screen.getByText('Edit Project', { selector: 'h3' }).closest('.drawer-panel');
    }
    const pill = (drawer, name) => within(within(drawer).getByTestId('department-pills')).getByText(new RegExp(`^${name}`));

    it('shows the current departments, and marks one that has tasks as locked', async () => {
      const drawer = await openProjectEditor();
      expect(pill(drawer, 'Piping')).toHaveAttribute('aria-pressed', 'true');
      expect(pill(drawer, 'Piping')).toHaveTextContent('(has tasks)');
      expect(pill(drawer, 'Structural')).toHaveAttribute('aria-pressed', 'true');
      expect(pill(drawer, 'Structural')).not.toHaveTextContent('(has tasks)');
      expect(pill(drawer, 'ESP')).toHaveAttribute('aria-pressed', 'false');
    });

    it('a department with tasks cannot be switched off', async () => {
      const drawer = await openProjectEditor();
      await userEvent.click(pill(drawer, 'Piping'));
      expect(pill(drawer, 'Piping')).toHaveAttribute('aria-pressed', 'true');
    });

    it('adds a department and sends the full new set', async () => {
      const { departments, ...rest } = makeProject();
      mocks.updateProject.mockResolvedValue({ ...rest, departments: [{ id: 1, name: 'Piping' }, { id: 2, name: 'Structural' }, { id: 3, name: 'ESP' }] });
      const drawer = await openProjectEditor();

      await userEvent.click(pill(drawer, 'ESP'));
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('1', expect.objectContaining({ departmentIds: [1, 2, 3] })));
      expect(await screen.findByText('Piping, Structural, ESP')).toBeInTheDocument();
    });

    it('removes a department that has no tasks', async () => {
      const { departments, ...rest } = makeProject();
      mocks.updateProject.mockResolvedValue({ ...rest, departments: [{ id: 1, name: 'Piping' }] });
      const drawer = await openProjectEditor();

      await userEvent.click(pill(drawer, 'Structural'));
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('1', expect.objectContaining({ departmentIds: [1] })));
    });

    it('leaves departments and manager out of the request when unchanged', async () => {
      const { departments, ...rest } = makeProject();
      mocks.updateProject.mockResolvedValue(rest);
      const drawer = await openProjectEditor();
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));

      await waitFor(() => expect(mocks.updateProject).toHaveBeenCalled());
      const payload = mocks.updateProject.mock.calls[0][1];
      expect(payload).not.toHaveProperty('departmentIds');
      expect(payload).not.toHaveProperty('projectManagerId');
    });

    it('offers the managers the server allows, and can change the project manager', async () => {
      const { departments, ...rest } = makeProject();
      mocks.updateProject.mockResolvedValue({ ...rest, projectManagerId: 2, projectManagerName: 'Second Manager' });
      const drawer = await openProjectEditor();

      const select = within(drawer).getByDisplayValue('Manager One');
      const names = within(select).getAllByRole('option').map((o) => o.textContent);
      expect(names).toEqual(['Manager One', 'Second Manager']);

      await userEvent.selectOptions(select, '2');
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('1', expect.objectContaining({ projectManagerId: 2 })));
      expect(await screen.findByText('Project Manager: Second Manager')).toBeInTheDocument();
    });

    it('shows the server’s reason when a change is refused', async () => {
      mocks.updateProject.mockRejectedValue(new Error('Cannot remove Structural: the project already has tasks in it.'));
      const drawer = await openProjectEditor();
      await userEvent.click(pill(drawer, 'ESP'));
      await userEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Cannot remove Structural: the project already has tasks in it.'));
    });
  });
});

describe('ProjectDetail — which departments can be assigned into', () => {
  const twoDepartments = [
    { department_id: 1, name: 'Piping', subDepartments: [{ id: 1, name: 'Input Study' }] },
    { department_id: 2, name: 'Structural', subDepartments: [{ id: 2, name: 'Modelling' }] },
  ];

  beforeEach(() => {
    Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
    mocks.getProject.mockResolvedValue(makeProject({ departments: [{ id: 1, name: 'Piping' }, { id: 2, name: 'Structural' }] }));
    mocks.listProjectTasks.mockResolvedValue([]);
    mocks.listDepartments.mockResolvedValue(twoDepartments);
    mocks.listProjectManagers.mockResolvedValue([]);
    mocks.listTeamLeaders.mockResolvedValue([{ id: 20, name: 'Hilal Al-Siyabi', department: 'Piping' }]);
    mocks.listCategories.mockResolvedValue(['Calculation', 'Modelling']);
    mocks.listTaskTimeLogs.mockResolvedValue([]);
  });

  const openForm = async (user) => {
    renderPage(user);
    await userEvent.click(await screen.findByRole('button', { name: '+ Assign Task' }));
    return screen.getByText('Assign Task', { selector: 'h3' }).closest('.drawer-panel');
  };

  it('a Department Head is offered only their own department, already selected', async () => {
    mocks.listAssignees.mockResolvedValue([{ id: 4, name: 'Ahmed Khalil', designation: 'Engineer', departmentId: 1 }]);
    const drawer = await openForm(departmentHead);
    const [department, subDepartment, , employee] = within(drawer).getAllByRole('combobox'); // the third is Category
    expect(within(department).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select department...', 'Piping']);
    expect(department).toHaveValue('1');
    // The next choices are ready without picking a department first.
    expect(within(subDepartment).getAllByRole('option').map((o) => o.textContent)).toContain('Input Study');
    expect(within(employee).getAllByRole('option').map((o) => o.textContent.split(' —')[0])).toContain('Ahmed Khalil');
  });

  it('a Project Manager who can assign into both departments chooses between them', async () => {
    mocks.listAssignees.mockResolvedValue([
      { id: 4, name: 'Ahmed Khalil', designation: 'Engineer', departmentId: 1 },
      { id: 8, name: 'Daniel Costa', designation: 'Engineer', departmentId: 2 },
    ]);
    const drawer = await openForm(manager);
    const [department] = within(drawer).getAllByRole('combobox');
    expect(within(department).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select department...', 'Piping', 'Structural']);
    expect(department).toHaveValue('');
  });

  it('a department with nobody to give work to is not offered', async () => {
    mocks.listAssignees.mockResolvedValue([{ id: 8, name: 'Daniel Costa', designation: 'Engineer', departmentId: 2 }]);
    const drawer = await openForm(manager);
    const [department] = within(drawer).getAllByRole('combobox');
    expect(within(department).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select department...', 'Structural']);
  });

  it('says so when there is nobody the person can give work to', async () => {
    mocks.listAssignees.mockResolvedValue([]);
    const drawer = await openForm(manager);
    expect(within(drawer).getByText(/nobody in this project's departments that you can give work to/i)).toBeInTheDocument();
  });

  it('the form starts fresh each time it is opened', async () => {
    mocks.listAssignees.mockResolvedValue([{ id: 4, name: 'Ahmed Khalil', designation: 'Engineer', departmentId: 1 }]);
    const drawer = await openForm(departmentHead);
    const [department] = within(drawer).getAllByRole('combobox');
    await userEvent.selectOptions(department, '');
    expect(department).toHaveValue('');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getAllByRole('button', { name: '+ Assign Task' })[0]);
    const [reopened] = within(screen.getByText('Assign Task', { selector: 'h3' }).closest('.drawer-panel')).getAllByRole('combobox');
    expect(reopened).toHaveValue('1');
  });
});
