import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Reports from './Reports';
import { makeProject, authOf, manager } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  projectDetailsReport: vi.fn(),
  employeeWorkTimeReport: vi.fn(),
  listDepartments: vi.fn(),
  listFlaggedSessions: vi.fn(),
  adjustSession: vi.fn(),
  exportToExcel: vi.fn(),
  exportToCsv: vi.fn(),
  exportToPdf: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/reports', () => ({
  projectDetailsReport: mocks.projectDetailsReport,
  employeeWorkTimeReport: mocks.employeeWorkTimeReport,
}));
vi.mock('../../api/departments', () => ({ listDepartments: mocks.listDepartments }));
vi.mock('../../api/timelogs', () => ({ listFlaggedSessions: mocks.listFlaggedSessions, adjustSession: mocks.adjustSession }));
vi.mock('../../utils/exportReport', () => ({ exportToExcel: mocks.exportToExcel, exportToPdf: mocks.exportToPdf, exportToCsv: mocks.exportToCsv }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => authOf(manager) }));

const projects = [
  makeProject({ id: 1, name: 'Alpha Plant', jobCode: 'T-001', status: 'In Progress', departments: ['Piping'], taskCount: 3 }),
  makeProject({ id: 2, name: 'Beta Tower', jobCode: 'T-002', status: 'Completed', departments: ['Structural'], taskCount: 1, completedManHours: 100 }),
];
const people = [
  { employeeId: 4, name: 'Ahmed Khalil', department: 'Piping', taskCount: 2, sessionCount: 5, totalHours: 12.5 },
];

const flaggedSessions = [
  {
    id: 31, taskId: 10, taskName: 'Pipe stress analysis', projectName: 'Alpha Plant', projectJobCode: 'T-001',
    employeeName: 'Ahmed Khalil', logDate: '2026-10-04', durationMinutes: 720, autoStopped: true, needsReview: true,
  },
  {
    id: 32, taskId: 11, taskName: 'Foundation analysis', projectName: 'Beta Tower', projectJobCode: 'T-002',
    employeeName: 'Daniel Costa', logDate: '2026-10-03', durationMinutes: 720, autoStopped: true, needsReview: true,
  },
];

async function renderPage(initialUrl = '/reports') {
  render(<MemoryRouter initialEntries={[initialUrl]}><Reports /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText(/loading reports/i)).not.toBeInTheDocument());
}

describe('Reports', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.projectDetailsReport.mockResolvedValue(projects);
    mocks.employeeWorkTimeReport.mockResolvedValue(people);
    mocks.listDepartments.mockResolvedValue([
      { department_id: 1, name: 'Piping', subDepartments: [], teams: [{ id: 5, name: 'Piping Team A' }] },
      { department_id: 2, name: 'Structural', subDepartments: [], teams: [{ id: 7, name: 'Structural Team A' }] },
    ]);
    mocks.exportToCsv.mockResolvedValue();
    mocks.listFlaggedSessions.mockResolvedValue({ timeLogs: flaggedSessions, maxSessionMinutes: 720 });
    mocks.adjustSession.mockResolvedValue({ id: 31, durationMinutes: 480, needsReview: false });
    mocks.exportToExcel.mockResolvedValue();
    mocks.exportToPdf.mockResolvedValue();
  });

  it('shows the project report with departments and progress', async () => {
    await renderPage();
    expect(screen.getByText('Beta Tower')).toBeInTheDocument();
    expect(screen.getByText('Structural', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('25 / 100')).toBeInTheDocument();
  });

  it('filters projects by status, department and search', async () => {
    await renderPage();
    const [statusFilter, deptFilter] = screen.getAllByRole('combobox');

    await userEvent.selectOptions(statusFilter, 'Completed');
    expect(screen.queryByText('Alpha Plant')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Tower')).toBeInTheDocument();

    await userEvent.selectOptions(statusFilter, 'All');
    await userEvent.selectOptions(deptFilter, 'Piping');
    expect(screen.getByText('Alpha Plant')).toBeInTheDocument();
    expect(screen.queryByText('Beta Tower')).not.toBeInTheDocument();

    await userEvent.selectOptions(deptFilter, 'All');
    await userEvent.type(screen.getByPlaceholderText(/search by project/i), 't-002');
    expect(screen.queryByText('Alpha Plant')).not.toBeInTheDocument();
  });

  it('employee report re-queries the server when date, project or department filters change', async () => {
    await renderPage();
    await userEvent.click(screen.getByText('Employee Work-Time Report'));
    expect(await screen.findByText('Ahmed Khalil')).toBeInTheDocument();

    const [deptFilter, teamFilter, projectFilter] = screen.getAllByRole('combobox');
    mocks.employeeWorkTimeReport.mockClear();

    await userEvent.selectOptions(deptFilter, 'Piping');
    await waitFor(() => expect(mocks.employeeWorkTimeReport).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: '1' })));

    // The team list follows the chosen department.
    expect(within(teamFilter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Teams', 'Piping Team A']);
    await userEvent.selectOptions(teamFilter, '5');
    await waitFor(() => expect(mocks.employeeWorkTimeReport).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: '1', teamId: '5' })));

    await userEvent.selectOptions(projectFilter, projects[0].id.toString());
    await waitFor(() => expect(mocks.employeeWorkTimeReport).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: '1', projectId: '1', teamId: '5' })));

    const [from] = document.querySelectorAll('input[type="date"]');
    await userEvent.type(from, '2026-09-01');
    await waitFor(() => expect(mocks.employeeWorkTimeReport).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-09-01' })));
  });

  it('exports exactly the rows the filters leave', async () => {
    await renderPage();
    await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'Completed');
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));

    await waitFor(() => expect(mocks.exportToExcel).toHaveBeenCalledTimes(1));
    const config = mocks.exportToExcel.mock.calls[0][0];
    expect(config.rows.map((r) => r.name)).toEqual(['Beta Tower']);
    expect(config.columns.map((c) => c.header)).toContain('Job Code');

    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(mocks.exportToPdf).toHaveBeenCalledTimes(1));
    expect(mocks.exportToPdf.mock.calls[0][0].title).toBe('Project Details Report');
  });

  it('does not export an empty report', async () => {
    await renderPage();
    await userEvent.type(screen.getByPlaceholderText(/search by project/i), 'zzz-no-match');
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(mocks.exportToPdf).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/nothing to export/i));
  });

  it('reports an export failure instead of failing silently', async () => {
    mocks.exportToExcel.mockRejectedValue(new Error('Export failed.'));
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Export failed.'));
  });
});

describe('Reports — session review', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.projectDetailsReport.mockResolvedValue(projects);
    mocks.employeeWorkTimeReport.mockResolvedValue(people);
    mocks.listDepartments.mockResolvedValue([]);
    mocks.listFlaggedSessions.mockResolvedValue({ timeLogs: flaggedSessions, maxSessionMinutes: 720 });
    mocks.adjustSession.mockResolvedValue({ id: 31, durationMinutes: 480, needsReview: false });
  });

  it('shows how many sessions need review on the tab', async () => {
    await renderPage();
    expect(screen.getByText('Session Review (2)')).toBeInTheDocument();
  });

  it('opens straight to the review queue from the link on the Projects page', async () => {
    render(<MemoryRouter initialEntries={['/reports?tab=review']}><Reports /></MemoryRouter>);
    expect(await screen.findByText('Pipe stress analysis')).toBeInTheDocument();
    expect(screen.getByText('Ahmed Khalil')).toBeInTheDocument();
    expect(screen.getByText('T-002 · Beta Tower')).toBeInTheDocument();
    expect(screen.getAllByText('12h 00m')).toHaveLength(2);
  });

  it('has no export buttons on the review tab', async () => {
    await renderPage('/reports?tab=review');
    await screen.findByText('Pipe stress analysis');
    expect(screen.queryByRole('button', { name: 'Export PDF' })).not.toBeInTheDocument();
  });

  it('Keep approves the session as recorded and removes it from the queue', async () => {
    await renderPage('/reports?tab=review');
    const row = (await screen.findByText('Ahmed Khalil')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Keep' }));

    await waitFor(() => expect(mocks.adjustSession).toHaveBeenCalledWith(31, 720, 'Reviewed and kept as recorded'));
    await waitFor(() => expect(screen.queryByText('Ahmed Khalil')).not.toBeInTheDocument());
    expect(screen.getByText('Daniel Costa')).toBeInTheDocument();
    expect(screen.getByText('Session Review (1)')).toBeInTheDocument();
  });

  it('Adjust needs a reason, then saves the corrected time', async () => {
    await renderPage('/reports?tab=review');
    const row = (await screen.findByText('Ahmed Khalil')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Adjust' }));

    const dialog = screen.getByText('Adjust session').closest('.modal-panel');
    const [hours, minutes] = within(dialog).getAllByRole('spinbutton');
    expect(hours).toHaveValue(12);
    await userEvent.clear(hours);
    await userEvent.type(hours, '8');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '30');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.adjustSession).not.toHaveBeenCalled();
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/short note/i));

    await userEvent.type(within(dialog).getByPlaceholderText(/confirmed with employee/i), 'Stopped work at 5:30pm');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.adjustSession).toHaveBeenCalledWith(31, 510, 'Stopped work at 5:30pm'));
    await waitFor(() => expect(screen.queryByText('Ahmed Khalil')).not.toBeInTheDocument());
  });

  it('rejects impossible times before calling the server', async () => {
    await renderPage('/reports?tab=review');
    const row = (await screen.findByText('Ahmed Khalil')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const dialog = screen.getByText('Adjust session').closest('.modal-panel');
    const [hours, minutes] = within(dialog).getAllByRole('spinbutton');
    await userEvent.type(within(dialog).getByPlaceholderText(/confirmed with employee/i), 'A valid reason');

    await userEvent.clear(minutes);
    await userEvent.type(minutes, '75');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/minutes 0–59/i));

    await userEvent.clear(minutes);
    await userEvent.type(minutes, '0');
    await userEvent.clear(hours);
    await userEvent.type(hours, '25');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/more than 24 hours/i));
    expect(mocks.adjustSession).not.toHaveBeenCalled();
  });

  it('shows the server’s message and keeps the dialog open if saving fails', async () => {
    mocks.adjustSession.mockRejectedValue(new Error('This session is still running.'));
    await renderPage('/reports?tab=review');
    const row = (await screen.findByText('Ahmed Khalil')).closest('tr');
    await userEvent.click(within(row).getByRole('button', { name: 'Adjust' }));
    const dialog = screen.getByText('Adjust session').closest('.modal-panel');
    await userEvent.type(within(dialog).getByPlaceholderText(/confirmed with employee/i), 'A valid reason');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('This session is still running.'));
    expect(screen.getByText('Adjust session')).toBeInTheDocument();
  });

  it('shows an empty state when nothing needs review', async () => {
    mocks.listFlaggedSessions.mockResolvedValue({ timeLogs: [], maxSessionMinutes: 720 });
    await renderPage('/reports?tab=review');
    expect(await screen.findByText('Nothing to review')).toBeInTheDocument();
    expect(screen.getByText('Session Review')).toBeInTheDocument();
  });
});


describe('Reports: CSV and team filter', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.projectDetailsReport.mockResolvedValue(projects);
    mocks.employeeWorkTimeReport.mockResolvedValue(people);
    mocks.listDepartments.mockResolvedValue([
      { department_id: 1, name: 'Piping', subDepartments: [], teams: [{ id: 5, name: 'Piping Team A' }] },
      { department_id: 2, name: 'Structural', subDepartments: [], teams: [{ id: 7, name: 'Structural Team A' }] },
    ]);
    mocks.listFlaggedSessions.mockResolvedValue({ timeLogs: [], maxSessionMinutes: 720 });
    mocks.exportToCsv.mockResolvedValue();
  });

  it('exports the project report as CSV', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.exportToCsv).toHaveBeenCalledTimes(1));
    expect(mocks.exportToCsv.mock.calls[0][0].fileName).toBe('project-details-report');
  });

  it('exports the employee report as CSV', async () => {
    await renderPage();
    await userEvent.click(screen.getByText('Employee Work-Time Report'));
    await screen.findByText('Ahmed Khalil');
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(mocks.exportToCsv).toHaveBeenCalledTimes(1));
    expect(mocks.exportToCsv.mock.calls[0][0].fileName).toBe('employee-work-time-report');
  });

  it('offers every team until a department is chosen, then only its own', async () => {
    await renderPage();
    await userEvent.click(screen.getByText('Employee Work-Time Report'));
    await screen.findByText('Ahmed Khalil');
    const team = screen.getByLabelText('Team');
    expect(within(team).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Teams', 'Piping Team A', 'Structural Team A']);
    await userEvent.selectOptions(screen.getByLabelText('Department'), '2');
    expect(within(team).getAllByRole('option').map((o) => o.textContent)).toEqual(['All Teams', 'Structural Team A']);
  });

  it('changing the department clears a team that no longer applies', async () => {
    await renderPage();
    await userEvent.click(screen.getByText('Employee Work-Time Report'));
    await screen.findByText('Ahmed Khalil');
    await userEvent.selectOptions(screen.getByLabelText('Team'), '5');
    await waitFor(() => expect(mocks.employeeWorkTimeReport).toHaveBeenLastCalledWith(expect.objectContaining({ teamId: '5' })));
    await userEvent.selectOptions(screen.getByLabelText('Department'), '2');
    await waitFor(() => expect(mocks.employeeWorkTimeReport).toHaveBeenLastCalledWith(expect.objectContaining({ departmentId: '2', teamId: '' })));
    expect(screen.getByLabelText('Team')).toHaveValue('All');
  });
});
