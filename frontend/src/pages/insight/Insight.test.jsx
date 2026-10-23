import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import ManHours from './ManHours';
import Exceptions from './Exceptions';

const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  listProjectHealth: vi.fn(),
  getProjectManHours: vi.fn(),
  listExceptions: vi.fn(),
  pushToast: vi.fn(),
  exportToExcel: vi.fn(),
}));

vi.mock('../../api/dashboard', () => ({
  getOverview: mocks.getOverview,
  listProjectHealth: mocks.listProjectHealth,
  getProjectManHours: mocks.getProjectManHours,
  listExceptions: mocks.listExceptions,
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));
vi.mock('../../utils/exportReport', () => ({ exportToExcel: mocks.exportToExcel }));

const health = (over = {}) => ({
  id: 1, jobCode: 'T-001', name: 'Saria Refinery', status: 'In Progress', priority: 'High',
  projectManagerName: 'Manager One', departments: ['Piping'], targetDate: null,
  estimatedManHours: 100, consumedManHours: 55, remainingManHours: 45, consumedPercent: 55,
  allocatedManHours: 40, taskCount: 3, tasksCompleted: 1, completionPercent: 50,
  projectedFinalManHours: 110, overdue: false, risk: 'AMBER',
  ...over,
});

const overview = (over = {}) => ({
  kind: 'team',
  scopeLabel: 'Piping Team A',
  stats: {
    people: 3, openTasks: 5, overdueTasks: 2, awaitingInput: 1, onHold: 1, runningNow: 1,
    hoursToday: 6, hoursWeek: 22.5, activeProjects: 2, atRiskProjects: 1, exceptions: 3, criticalExceptions: 1,
  },
  statusCounts: { 'In Progress': 3, 'Awaiting Input': 1, 'On Hold': 1, Completed: 4 },
  people: [
    { id: 4, name: 'Ahmed Khalil', designation: 'Sr. Engineer', department: 'Piping', team: 'Piping Team A', isTeamLeader: false, openTasks: 3, overdueTasks: 2, blockedTasks: 0, hoursToday: 4, hoursWeek: 15, runningTask: 'Pipe stress analysis' },
    { id: 20, name: 'Hilal Al-Siyabi', designation: 'Team Leader', department: 'Piping', team: 'Piping Team A', isTeamLeader: true, openTasks: 2, overdueTasks: 0, blockedTasks: 2, hoursToday: 2, hoursWeek: 7.5, runningTask: null },
  ],
  projects: [health(), health({ id: 2, jobCode: 'T-002', name: 'Quiet Project', risk: 'GREEN', consumedManHours: 5, consumedPercent: 5, completionPercent: 10 })],
  exceptions: [
    { key: 'a', type: 'task-overdue', category: 'Overdue task', severity: 'critical', title: 'Overdue by 5 days', detail: '"Pipe stress analysis" — Ahmed Khalil', projectId: 1, projectName: 'Saria Refinery' },
  ],
  ...over,
});

const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()));

describe('Dashboard', () => {
  it('shows the figures, people and projects of the scope the server returned', async () => {
    mocks.getOverview.mockResolvedValue(overview());
    inRouter(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'Team Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Piping Team A', { selector: '.page-sub' })).toBeInTheDocument();

    const stat = (label) => screen.getByText(label).closest('.stat-card');
    expect(within(stat('Open Tasks')).getByText('5')).toBeInTheDocument();
    expect(within(stat('Overdue Tasks')).getByText('2')).toBeInTheDocument();
    expect(within(stat('Waiting / On Hold')).getByText('2')).toBeInTheDocument();
    expect(within(stat('Hours This Week')).getByText('22.5')).toBeInTheDocument();
    expect(within(stat('Projects At Risk')).getByText('1 / 2')).toBeInTheDocument();
    expect(within(stat('Exceptions')).getByText('1 critical')).toBeInTheDocument();

    expect(screen.getByText('Ahmed Khalil')).toBeInTheDocument();
    expect(screen.getByText('Hilal Al-Siyabi · Team Leader')).toBeInTheDocument();
    expect(screen.getByText('Pipe stress analysis', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('AMBER')).toBeInTheDocument();
    expect(screen.getByText('GREEN')).toBeInTheDocument();
    expect(screen.getByText('Overdue by 5 days')).toBeInTheDocument();
  });

  it('shows every task status, including those with no tasks', async () => {
    mocks.getOverview.mockResolvedValue(overview());
    inRouter(<Dashboard />);
    await screen.findByText('Task status');
    for (const text of ['Not Started: 0', 'In Progress: 3', 'Partially Completed: 0', 'Awaiting Input: 1', 'On Hold: 1', 'Completed: 4']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('is titled for the department and company views, and adds a Department column for the company', async () => {
    mocks.getOverview.mockResolvedValue(overview({ kind: 'department', scopeLabel: 'Piping' }));
    const { unmount } = inRouter(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'Department Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Department' })).not.toBeInTheDocument();
    unmount();

    mocks.getOverview.mockResolvedValue(overview({ kind: 'company', scopeLabel: 'Whole company' }));
    inRouter(<Dashboard />);
    expect(await screen.findByRole('heading', { name: 'Company Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
  });

  it('says when nothing needs attention and offers a retry when loading fails', async () => {
    mocks.getOverview.mockResolvedValueOnce(overview({ exceptions: [] }));
    const { unmount } = inRouter(<Dashboard />);
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
    unmount();

    mocks.getOverview.mockRejectedValueOnce(new Error('Server down'));
    mocks.getOverview.mockResolvedValueOnce(overview());
    inRouter(<Dashboard />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Team Dashboard' })).toBeInTheDocument();
  });
});

describe('Project man-hours', () => {
  beforeEach(() => {
    mocks.listProjectHealth.mockResolvedValue([
      health(),
      health({ id: 2, jobCode: 'T-002', name: 'Over Budget', risk: 'RED', consumedManHours: 120, consumedPercent: 120, remainingManHours: 0 }),
      health({ id: 3, jobCode: 'T-003', name: 'Fine Project', risk: 'GREEN', consumedManHours: 5, consumedPercent: 5 }),
    ]);
  });

  it('lists each project with budget, consumed, remaining, projection and risk', async () => {
    inRouter(<ManHours />);
    const row = (await screen.findByText('Saria Refinery')).closest('tr');
    for (const value of ['100', '55', '45', '55%', '50%', '110', 'AMBER']) {
      expect(within(row).getByText(value)).toBeInTheDocument();
    }
    expect(within(screen.getByText('Fine Project').closest('tr')).getByText('GREEN')).toBeInTheDocument();
  });

  it('shows a dash when there is not enough progress to project', async () => {
    mocks.listProjectHealth.mockResolvedValue([health({ projectedFinalManHours: null })]);
    inRouter(<ManHours />);
    const row = (await screen.findByText('Saria Refinery')).closest('tr');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('filters by risk level', async () => {
    inRouter(<ManHours />);
    await screen.findByText('Saria Refinery');
    await userEvent.selectOptions(screen.getByLabelText('Risk'), 'RED');
    expect(screen.getByText('Over Budget')).toBeInTheDocument();
    expect(screen.queryByText('Saria Refinery')).not.toBeInTheDocument();
    expect(screen.queryByText('Fine Project')).not.toBeInTheDocument();
  });

  it('opens the hours breakdown of the project that is clicked', async () => {
    mocks.getProjectManHours.mockResolvedValue({
      ...health(),
      byEmployee: [{ id: 4, name: 'Ahmed Khalil', hours: 30 }, { id: 5, name: 'Vivek Rao', hours: 25 }],
      byTaskType: [{ id: 11, name: 'Input Study', hours: 55 }],
      byDepartment: [{ id: 1, name: 'Piping', hours: 55 }],
    });
    inRouter(<ManHours />);
    await userEvent.click(await screen.findByText('Saria Refinery'));
    const panel = await screen.findByTestId('manhour-breakdown');
    expect(mocks.getProjectManHours).toHaveBeenCalledWith(1);
    await within(panel).findByText('Ahmed Khalil');
    expect(within(panel).getByText('30h')).toBeInTheDocument();
    expect(within(panel).getByText('Input Study')).toBeInTheDocument();
    expect(within(panel).getByText('By department')).toBeInTheDocument();
  });

  it('exports what is currently shown', async () => {
    inRouter(<ManHours />);
    await screen.findByText('Saria Refinery');
    await userEvent.selectOptions(screen.getByLabelText('Risk'), 'GREEN');
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(mocks.exportToExcel).toHaveBeenCalledTimes(1);
    expect(mocks.exportToExcel.mock.calls[0][0].rows.map((r) => r.name)).toEqual(['Fine Project']);
  });
});

describe('Exceptions', () => {
  const items = [
    { key: '1', type: 'task-overdue', category: 'Overdue task', severity: 'critical', title: 'Overdue by 5 days', detail: '"Pipe stress analysis" — Ahmed Khalil', projectId: 1, projectName: 'Saria Refinery' },
    { key: '2', type: 'task-awaiting-input', category: 'Awaiting input', severity: 'attention', title: 'Waiting on input', detail: '"Layout" — Vivek Rao', projectId: 2, projectName: 'Other Project' },
  ];

  it('lists exceptions with severity, detail and a link to the project', async () => {
    mocks.listExceptions.mockResolvedValue(items);
    inRouter(<Exceptions />);
    expect(await screen.findByText('Overdue by 5 days')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Critical')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Attention')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saria Refinery' })).toHaveAttribute('href', '/projects/1');
  });

  it('asks the server again when the filters change', async () => {
    mocks.listExceptions.mockResolvedValue(items);
    inRouter(<Exceptions />);
    await screen.findByText('Overdue by 5 days');
    expect(mocks.listExceptions).toHaveBeenLastCalledWith({ severity: '', type: '' });

    mocks.listExceptions.mockResolvedValue([items[0]]);
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'critical');
    await waitFor(() => expect(mocks.listExceptions).toHaveBeenLastCalledWith({ severity: 'critical', type: '' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'task-overdue');
    await waitFor(() => expect(mocks.listExceptions).toHaveBeenLastCalledWith({ severity: 'critical', type: 'task-overdue' }));
    await waitFor(() => expect(screen.queryByText('Waiting on input')).not.toBeInTheDocument());
  });

  it('shows an encouraging message when there are none', async () => {
    mocks.listExceptions.mockResolvedValue([]);
    inRouter(<Exceptions />);
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
  });
});
