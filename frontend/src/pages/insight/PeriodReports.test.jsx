import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WorkReport from './WorkReport';
import Summary from './Summary';
import { authOf, person, employee, manager, teamLeader } from '../../test/fixtures';
import { todayStr, shiftDate } from '../../utils/dates';

const mocks = vi.hoisted(() => ({
  persona: null,
  employeeReport: vi.fn(),
  summaryReport: vi.fn(),
  listEmployees: vi.fn(),
  pushToast: vi.fn(),
  exportToExcel: vi.fn(),
  exportToPdf: vi.fn(),
  exportToCsv: vi.fn(),
}));

vi.mock('../../api/reports', () => ({ employeeReport: mocks.employeeReport, summaryReport: mocks.summaryReport }));
vi.mock('../../api/employees', () => ({ listEmployees: mocks.listEmployees }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authOf(mocks.persona) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));
vi.mock('../../utils/exportReport', () => ({ exportToExcel: mocks.exportToExcel, exportToPdf: mocks.exportToPdf, exportToCsv: mocks.exportToCsv }));

const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

const report = (over = {}) => ({
  employee: { id: 4, name: 'Ahmed Khalil', designation: 'Sr. Engineer', department: 'Piping', team: 'Piping Team A', status: 'active' },
  period: 'week', from: '2026-10-05', to: '2026-10-11',
  totalHours: 6.5, sessionCount: 4, daysWorked: 3, averageHoursPerDayWorked: 2.2,
  byProject: [{ id: 1, name: 'Saria Refinery', jobCode: 'T-001', hours: 6, tasks: 2, sessions: 3 }, { id: 2, name: 'Al Reem', jobCode: 'T-002', hours: 0.5, tasks: 1, sessions: 1 }],
  byCategory: [{ id: 'Calculation', name: 'Calculation', hours: 5, tasks: 1, sessions: 2 }, { id: 'Uncategorised', name: 'Uncategorised', hours: 1.5, tasks: 2, sessions: 2 }],
  daily: [2, 0, 4, 0, 0.5, 0, 0].map((hours, i) => ({ date: `2026-10-${String(5 + i).padStart(2, '0')}`, hours })),
  taskStatus: { 'In Progress': 2, Completed: 1 },
  openPlannedHours: 40, tasksCompletedInPeriod: 1,
  ...over,
});

const summary = (over = {}) => ({
  period: 'day', from: '2026-10-07', to: '2026-10-07',
  totalHours: 13, sessionCount: 4, peopleWhoLogged: 3,
  people: { total: 5, withHours: 3, withoutHours: 2 },
  tasksCompleted: 2, overdueTasks: 1,
  byProject: [{ id: 1, name: 'Saria Refinery', jobCode: 'T-001', hours: 12, tasks: 3, sessions: 3 }],
  byDepartment: [{ id: 1, name: 'Piping', hours: 8, tasks: 2, sessions: 2 }, { id: 2, name: 'Structural', hours: 5, tasks: 1, sessions: 1 }],
  byEmployee: [{ id: 4, name: 'Ahmed Khalil', hours: 4, tasks: 1, sessions: 1 }],
  byCategory: [{ id: 'Review', name: 'Review', hours: 3, tasks: 1, sessions: 1 }],
  daily: [{ date: '2026-10-07', hours: 13 }],
  topProjects: [{ id: 1, name: 'Saria Refinery', jobCode: 'T-001', hours: 12, tasks: 3, sessions: 3 }],
  projectsNearingBudget: [{ id: 1, name: 'Saria Refinery', jobCode: 'T-001', consumedPercent: 92, completionPercent: 55, risk: 'RED' }],
  majorExceptions: [{ key: 'a', category: 'Overdue task', severity: 'critical', title: 'Overdue by 5 days', detail: '"Pipe stress" — Ahmed Khalil' }],
  ...over,
});

beforeEach(() => {
  Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
  mocks.persona = manager;
  mocks.employeeReport.mockResolvedValue(report());
  mocks.summaryReport.mockResolvedValue(summary());
  mocks.listEmployees.mockResolvedValue([
    person({ id: 4, name: 'Ahmed Khalil', role: 'employee', department: 'Piping', status: 'active' }),
    person({ id: 20, name: 'Hilal Al-Siyabi', role: 'team_leader', department: 'Piping', status: 'active' }),
    person({ id: 21, name: 'Khalid Head', role: 'department_head', status: 'active' }),
    person({ id: 9, name: 'Gone Person', role: 'employee', status: 'inactive' }),
  ]);
  [mocks.exportToExcel, mocks.exportToPdf, mocks.exportToCsv].forEach((m) => m.mockResolvedValue());
});

describe('My Report', () => {
  beforeEach(() => { mocks.persona = employee; });

  it('shows the signed-in person’s own week, with no person picker', async () => {
    inRouter(<WorkReport own />);
    expect(await screen.findByText('6.5h')).toBeInTheDocument();
    expect(mocks.employeeReport).toHaveBeenCalledWith(employee.id, 'week', todayStr());
    expect(screen.getByRole('heading', { name: 'My Report' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    expect(mocks.listEmployees).not.toHaveBeenCalled();
  });

  it('shows the figures, projects and categories', async () => {
    inRouter(<WorkReport own />);
    await screen.findByText('6.5h');
    const stat = (label) => screen.getByText(label).closest('.stat-card');
    expect(within(stat('Days Worked')).getByText('3')).toBeInTheDocument();
    expect(within(stat('Days Worked')).getByText('2.2h per day worked')).toBeInTheDocument();
    expect(within(stat('Tasks Finished')).getByText('1')).toBeInTheDocument();
    expect(within(stat('Open Work (planned)')).getByText('40h')).toBeInTheDocument();
    const project = screen.getByText('Saria Refinery').closest('tr');
    expect(within(project).getByText('T-001')).toBeInTheDocument();
    expect(within(project).getByText('6h')).toBeInTheDocument();
    expect(within(screen.getByText('Calculation', { selector: 'td' }).closest('tr')).getByText('5h')).toBeInTheDocument();
    expect(screen.getByText('In Progress: 2')).toBeInTheDocument();
    expect(screen.getByText('Completed: 1')).toBeInTheDocument();
    expect(screen.getByText('Not Started: 0')).toBeInTheDocument();
  });

  it('shows a trend for a week or month, but not for a single day', async () => {
    inRouter(<WorkReport own />);
    await screen.findByText('6.5h');
    expect(screen.getByText('Hours by day')).toBeInTheDocument();
    mocks.employeeReport.mockResolvedValue(report({ period: 'day', from: '2026-10-07', to: '2026-10-07', daily: [{ date: '2026-10-07', hours: 6.5 }] }));
    await userEvent.click(screen.getByText('Day'));
    await waitFor(() => expect(screen.queryByText('Hours by day')).not.toBeInTheDocument());
  });

  it('changes period and date, asking the server each time', async () => {
    inRouter(<WorkReport own />);
    await screen.findByText('6.5h');
    await userEvent.click(screen.getByText('Month'));
    await waitFor(() => expect(mocks.employeeReport).toHaveBeenLastCalledWith(employee.id, 'month', todayStr()));
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(mocks.employeeReport).toHaveBeenLastCalledWith(employee.id, 'month', shiftDate(todayStr(), 'month', -1)));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-03-12' } });
    await waitFor(() => expect(mocks.employeeReport).toHaveBeenLastCalledWith(employee.id, 'month', '2026-03-12'));
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(mocks.employeeReport).toHaveBeenLastCalledWith(employee.id, 'month', todayStr()));
  });

  it('exports every group in one file in each format', async () => {
    inRouter(<WorkReport own />);
    await screen.findByText('6.5h');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.exportToCsv).toHaveBeenCalledTimes(1));
    const config = mocks.exportToCsv.mock.calls[0][0];
    expect(config.rows.map((r) => r.group)).toEqual(['Project', 'Project', 'Category', 'Category', ...Array(7).fill('Day')]);
    expect(config.rows[0].name).toBe('T-001 — Saria Refinery');
    expect(config.fileName).toBe('work-report-ahmed-khalil-2026-10-05');
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(mocks.exportToPdf).toHaveBeenCalledTimes(1));
    expect(mocks.exportToPdf.mock.calls[0][0].title).toBe('Work Report — Ahmed Khalil');
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(mocks.exportToExcel).toHaveBeenCalledTimes(1));
  });

  it('says so when an export fails', async () => {
    mocks.exportToCsv.mockRejectedValue(new Error('Disk full'));
    inRouter(<WorkReport own />);
    await screen.findByText('6.5h');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Disk full'));
  });

  it('offers a retry when loading fails', async () => {
    mocks.employeeReport.mockRejectedValueOnce(new Error('Server down'));
    inRouter(<WorkReport own />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('6.5h')).toBeInTheDocument();
  });
});

describe('Work Report (someone else’s)', () => {
  it('offers the active people who log work, and starts with the first', async () => {
    inRouter(<WorkReport />);
    await screen.findByText('6.5h');
    const picker = screen.getByLabelText('Person');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ahmed Khalil — Piping', 'Hilal Al-Siyabi — Piping']);
    expect(mocks.employeeReport).toHaveBeenCalledWith(4, 'week', todayStr());
  });

  it('shows another person when chosen', async () => {
    inRouter(<WorkReport />);
    await screen.findByText('6.5h');
    mocks.employeeReport.mockResolvedValue(report({ employee: { id: 20, name: 'Hilal Al-Siyabi', designation: 'Team Leader', department: 'Piping', team: 'Piping Team A', status: 'active' }, totalHours: 2 }));
    await userEvent.selectOptions(screen.getByLabelText('Person'), '20');
    await waitFor(() => expect(mocks.employeeReport).toHaveBeenLastCalledWith(20, 'week', todayStr()));
    expect(await screen.findByText('2h')).toBeInTheDocument();
  });

  it('says so when there is nobody to report on', async () => {
    mocks.listEmployees.mockResolvedValue([]);
    inRouter(<WorkReport />);
    expect(await screen.findByText('Nobody to report on')).toBeInTheDocument();
    expect(mocks.employeeReport).not.toHaveBeenCalled();
  });
});

describe('Summary', () => {
  it('starts on today’s end-of-day summary', async () => {
    mocks.persona = teamLeader;
    inRouter(<Summary />);
    expect(await screen.findByRole('heading', { name: 'End-of-Day Summary' })).toBeInTheDocument();
    expect(mocks.summaryReport).toHaveBeenCalledWith('day', todayStr());
    const stat = (label) => screen.getByText(label).closest('.stat-card');
    expect(within(stat('Hours Logged')).getByText('13h')).toBeInTheDocument();
    expect(within(stat('People Who Logged')).getByText('3 / 5')).toBeInTheDocument();
    expect(within(stat('People Who Logged')).getByText('2 without hours')).toBeInTheDocument();
    expect(within(stat('Tasks Finished')).getByText('2')).toBeInTheDocument();
    expect(within(stat('Overdue Tasks')).getByText('1')).toBeInTheDocument();
  });

  it('lists projects near their budget and the major exceptions', async () => {
    inRouter(<Summary />);
    await screen.findByText('Projects nearing or over budget');
    expect(screen.getByText('T-001 · 92% of budget used, 55% done')).toBeInTheDocument();
    expect(screen.getByText('RED')).toBeInTheDocument();
    expect(screen.getByText('Overdue by 5 days')).toBeInTheDocument();
  });

  it('says so when everything is fine', async () => {
    mocks.summaryReport.mockResolvedValue(summary({ projectsNearingBudget: [], majorExceptions: [] }));
    inRouter(<Summary />);
    expect(await screen.findByText('All projects are within budget')).toBeInTheDocument();
    expect(screen.getByText('Nothing critical')).toBeInTheDocument();
  });

  it('shows the breakdown tables', async () => {
    inRouter(<Summary />);
    await screen.findByText('By department');
    expect(within(screen.getByText('Piping', { selector: 'td' }).closest('tr')).getByText('8h')).toBeInTheDocument();
    expect(screen.getByText('Ahmed Khalil', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('Review', { selector: 'td' })).toBeInTheDocument();
  });

  it('switches to the weekly and monthly summaries, with a trend chart', async () => {
    inRouter(<Summary />);
    await screen.findByText('Hours Logged');
    expect(screen.queryByText('Hours by day')).not.toBeInTheDocument();
    mocks.summaryReport.mockResolvedValue(summary({ period: 'week', from: '2026-10-05', to: '2026-10-11', daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(5 + i).padStart(2, '0')}`, hours: i })) }));
    await userEvent.click(screen.getByText('Week'));
    expect(await screen.findByRole('heading', { name: 'Weekly Summary' })).toBeInTheDocument();
    expect(await screen.findByText('Hours by day')).toBeInTheDocument();
    mocks.summaryReport.mockResolvedValue(summary({ period: 'month', from: '2026-10-01', to: '2026-10-31' }));
    await userEvent.click(screen.getByText('Month'));
    expect(await screen.findByRole('heading', { name: 'Monthly Summary' })).toBeInTheDocument();
  });

  it('shows how many people logged for roles that do not look after people', async () => {
    mocks.summaryReport.mockResolvedValue(summary({ people: null, peopleWhoLogged: 3 }));
    inRouter(<Summary />);
    await screen.findByText('People Who Logged');
    const stat = screen.getByText('People Who Logged').closest('.stat-card');
    expect(within(stat).getByText('3')).toBeInTheDocument();
    expect(within(stat).queryByText(/without hours/)).not.toBeInTheDocument();
  });

  it('exports all groups, naming the file by period and start date', async () => {
    inRouter(<Summary />);
    await screen.findByText('Hours Logged');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.exportToCsv).toHaveBeenCalledTimes(1));
    const config = mocks.exportToCsv.mock.calls[0][0];
    expect(config.fileName).toBe('day-summary-2026-10-07');
    expect(config.rows.map((r) => [r.group, r.name])).toEqual([
      ['Project', 'T-001 — Saria Refinery'], ['Department', 'Piping'], ['Department', 'Structural'], ['Employee', 'Ahmed Khalil'], ['Category', 'Review'],
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(mocks.exportToPdf).toHaveBeenCalledTimes(1));
    expect(mocks.exportToPdf.mock.calls[0][0].subtitle).toBe('13 hours logged');
  });

  it('offers a retry when loading fails', async () => {
    mocks.summaryReport.mockRejectedValueOnce(new Error('Server down'));
    inRouter(<Summary />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('13h')).toBeInTheDocument();
  });
});
