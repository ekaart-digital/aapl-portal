import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import ManHours from './ManHours';
import Exceptions from './Exceptions';

// What Version 1 completion added to the insight screens: hours against
// allocation and people with no work on the dashboard, the category
// breakdown, the no-allocation exception, and CSV export.
const mocks = vi.hoisted(() => ({
  getOverview: vi.fn(),
  listProjectHealth: vi.fn(),
  getProjectManHours: vi.fn(),
  listExceptions: vi.fn(),
  pushToast: vi.fn(),
  exportToCsv: vi.fn(),
  exportToExcel: vi.fn(),
}));

vi.mock('../../api/dashboard', () => ({
  getOverview: mocks.getOverview,
  listProjectHealth: mocks.listProjectHealth,
  getProjectManHours: mocks.getProjectManHours,
  listExceptions: mocks.listExceptions,
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));
vi.mock('../../utils/exportReport', () => ({ exportToCsv: mocks.exportToCsv, exportToExcel: mocks.exportToExcel }));

const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const overview = () => ({
  kind: 'team', scopeLabel: 'Piping Team A',
  stats: {
    people: 3, withoutAllocation: 1, allocatedHours: 120, loggedHours: 45.5, openTasks: 5, overdueTasks: 0, awaitingInput: 0, onHold: 0,
    runningNow: 0, hoursToday: 0, hoursWeek: 12, activeProjects: 1, atRiskProjects: 0, exceptions: 1, criticalExceptions: 0,
  },
  statusCounts: {},
  people: [
    { id: 4, name: 'Ahmed Khalil', designation: 'Engineer', department: 'Piping', team: 'Piping Team A', isTeamLeader: false, openTasks: 3, overdueTasks: 0, blockedTasks: 0, hoursToday: 0, hoursWeek: 6, runningTask: null },
    { id: 5, name: 'Idle Person', designation: 'Engineer', department: 'Piping', team: 'Piping Team A', isTeamLeader: false, openTasks: 0, overdueTasks: 0, blockedTasks: 0, hoursToday: 0, hoursWeek: 0, runningTask: null },
  ],
  projects: [], exceptions: [],
});

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  mocks.exportToCsv.mockResolvedValue();
});

describe('dashboard additions', () => {
  it('shows logged against allocated hours and how many people have no work', async () => {
    mocks.getOverview.mockResolvedValue(overview());
    inRouter(<Dashboard />);
    await screen.findByText('Logged vs Allocated');
    const stat = (label) => screen.getByText(label).closest('.stat-card');
    expect(within(stat('Logged vs Allocated')).getByText('45.5 / 120h')).toBeInTheDocument();
    expect(within(stat('Without Allocation')).getByText('1')).toBeInTheDocument();
  });

  it('marks a person with no open tasks', async () => {
    mocks.getOverview.mockResolvedValue(overview());
    inRouter(<Dashboard />);
    const idle = (await screen.findByText('Idle Person')).closest('tr');
    expect(within(idle).getByText('None')).toBeInTheDocument();
    expect(within(screen.getByText('Ahmed Khalil').closest('tr')).getByText('3')).toBeInTheDocument();
  });
});

describe('man-hours additions', () => {
  beforeEach(() => {
    mocks.listProjectHealth.mockResolvedValue([{
      id: 1, jobCode: 'T-001', name: 'Saria Refinery', status: 'In Progress', projectManagerName: 'Manager One',
      estimatedManHours: 100, consumedManHours: 55, remainingManHours: 45, consumedPercent: 55, completionPercent: 50,
      projectedFinalManHours: 110, risk: 'AMBER',
    }]);
  });

  it('shows hours by task category in the breakdown', async () => {
    mocks.getProjectManHours.mockResolvedValue({
      id: 1, name: 'Saria Refinery',
      byEmployee: [], byTaskType: [], byDepartment: [],
      byCategory: [{ id: 'Calculation', name: 'Calculation', hours: 30 }, { id: 'Uncategorised', name: 'Uncategorised', hours: 5 }],
    });
    inRouter(<ManHours />);
    await userEvent.click(await screen.findByText('Saria Refinery'));
    const panel = await screen.findByTestId('manhour-breakdown');
    await within(panel).findByText('By category');
    expect(within(panel).getByText('Calculation')).toBeInTheDocument();
    expect(within(panel).getByText('30h')).toBeInTheDocument();
    expect(within(panel).getByText('Uncategorised')).toBeInTheDocument();
  });

  it('copes with a server that sends no categories', async () => {
    mocks.getProjectManHours.mockResolvedValue({ id: 1, name: 'Saria Refinery', byEmployee: [], byTaskType: [], byDepartment: [] });
    inRouter(<ManHours />);
    await userEvent.click(await screen.findByText('Saria Refinery'));
    const panel = await screen.findByTestId('manhour-breakdown');
    await within(panel).findByText('By category');
  });

  it('exports the rows shown as CSV', async () => {
    inRouter(<ManHours />);
    await screen.findByText('Saria Refinery');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.exportToCsv).toHaveBeenCalledTimes(1));
    expect(mocks.exportToCsv.mock.calls[0][0].fileName).toBe('project-man-hours');
    expect(mocks.exportToCsv.mock.calls[0][0].rows).toHaveLength(1);
  });
});

describe('exception screen additions', () => {
  const idleItem = { key: 'n1', type: 'no-allocation', category: 'No allocation', severity: 'attention', title: 'No project allocation', detail: 'Idle Person — Engineer has no open work', projectId: null, projectName: '', employeeName: 'Idle Person' };
  const overdueItem = { key: 'o1', type: 'task-overdue', category: 'Overdue task', severity: 'critical', title: 'Overdue by 5 days', detail: '"Calc" — Ahmed Khalil', projectId: 1, projectName: 'Saria Refinery' };

  it('lists people with no allocation, with a dash instead of a project link', async () => {
    mocks.listExceptions.mockResolvedValue([overdueItem, idleItem]);
    inRouter(<Exceptions />);
    const row = (await screen.findByText('No project allocation')).closest('tr');
    expect(within(row).getByText('Idle Person — Engineer has no open work')).toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
    expect(within(screen.getByText('Overdue by 5 days').closest('tr')).getByRole('link', { name: 'Saria Refinery' })).toBeInTheDocument();
  });

  it('can be filtered to that type', async () => {
    mocks.listExceptions.mockResolvedValue([idleItem]);
    inRouter(<Exceptions />);
    await screen.findByText('No project allocation');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'no-allocation');
    await waitFor(() => expect(mocks.listExceptions).toHaveBeenLastCalledWith({ severity: '', type: 'no-allocation' }));
  });

  it('exports what is shown as CSV', async () => {
    mocks.listExceptions.mockResolvedValue([overdueItem, idleItem]);
    inRouter(<Exceptions />);
    await screen.findByText('No project allocation');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.exportToCsv).toHaveBeenCalledTimes(1));
    const { rows, fileName } = mocks.exportToCsv.mock.calls[0][0];
    expect(fileName).toBe('exceptions');
    expect(rows.map((r) => r.category)).toEqual(['Overdue task', 'No allocation']);
  });

  it('has nothing to export when there are no exceptions', async () => {
    mocks.listExceptions.mockResolvedValue([]);
    inRouter(<Exceptions />);
    await screen.findByText('Nothing needs attention');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});
