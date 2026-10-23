import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Audit, { describeDetails } from './Audit';

const mocks = vi.hoisted(() => ({
  listAudit: vi.fn(),
  pushToast: vi.fn(),
  exportToExcel: vi.fn(),
}));

vi.mock('../../api/audit', () => ({ listAudit: mocks.listAudit }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));
vi.mock('../../utils/exportReport', () => ({ exportToExcel: mocks.exportToExcel }));

const entry = (over = {}) => ({
  id: 1, at: '2026-10-05T09:30:00', actorId: 22, actorName: 'Layan Al-Mahrouqi', actorRole: 'hr_admin',
  action: 'employee.update', entityType: 'employee', entityId: 4, summary: 'Updated Ahmed Khalil: designation',
  details: { designation: { from: 'Engineer', to: 'Senior Engineer' } }, ...over,
});

const page = (entries, total = entries.length) => ({ total, entityTypes: ['employee', 'department', 'team'], entries });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.listAudit.mockResolvedValue(page([
    entry(),
    entry({ id: 2, actorName: 'System', actorRole: null, action: 'time-log.auto-stop', entityType: 'time-log', summary: 'Stopped a timer at the limit', details: { creditedMinutes: 720 } }),
  ]));
});

describe('describeDetails', () => {
  it('writes a change as "from → to"', () => {
    expect(describeDetails({ status: { from: 'Planning', to: 'In Progress' } })).toEqual(['status: Planning → In Progress']);
  });

  it('writes a single change without a field name', () => {
    expect(describeDetails({ from: 'employee', to: 'team_leader' })).toEqual(['employee → team_leader']);
  });

  it('shows empty values as a dash and plain values as they are', () => {
    expect(describeDetails({ designation: { from: null, to: 'Lead' }, note: 'Reviewed', minutes: 720, ids: [1, 2] }))
      .toEqual(['designation: — → Lead', 'note: Reviewed', 'minutes: 720', 'ids: [1,2]']);
  });

  it('copes with nothing to show', () => {
    expect(describeDetails(null)).toEqual([]);
    expect(describeDetails(undefined)).toEqual([]);
    expect(describeDetails('text')).toEqual([]);
  });
});

describe('Audit trail', () => {
  it('lists who did what, with their role, and System for automatic actions', async () => {
    render(<Audit />);
    const row = (await screen.findByText('Updated Ahmed Khalil: designation')).closest('tr');
    expect(within(row).getByText('Layan Al-Mahrouqi')).toBeInTheDocument();
    expect(within(row).getByText('HR / Admin')).toBeInTheDocument();
    expect(within(row).getByText('employee.update')).toBeInTheDocument();
    const auto = screen.getByText('Stopped a timer at the limit').closest('tr');
    expect(within(auto).getByText('System', { selector: '.cell-primary' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
  });

  it('shows the old and new values when Details is opened, and hides them again', async () => {
    render(<Audit />);
    const row = (await screen.findByText('Updated Ahmed Khalil: designation')).closest('tr');
    expect(screen.queryByText('designation: Engineer → Senior Engineer')).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Details' }));
    expect(screen.getByText('designation: Engineer → Senior Engineer')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('designation: Engineer → Senior Engineer')).not.toBeInTheDocument();
  });

  it('offers only the areas the server says this role may read', async () => {
    render(<Audit />);
    await screen.findByText('Updated Ahmed Khalil: designation');
    const options = within(screen.getByLabelText('Area')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All areas', 'People', 'Departments', 'Teams']);
  });

  it('applies the filters only when asked, and starts again from the first page', async () => {
    render(<Audit />);
    await screen.findByText('Updated Ahmed Khalil: designation');
    mocks.listAudit.mockClear();

    await userEvent.selectOptions(screen.getByLabelText('Area'), 'employee');
    await userEvent.type(screen.getByLabelText('Search'), 'Ahmed');
    expect(mocks.listAudit).not.toHaveBeenCalled(); // nothing until Apply

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mocks.listAudit).toHaveBeenCalledWith({ entityType: 'employee', q: 'Ahmed', from: '', to: '', limit: 50, offset: 0 }));
  });

  it('pages through the trail', async () => {
    mocks.listAudit.mockResolvedValue(page([entry()], 120));
    render(<Audit />);
    expect(await screen.findByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => expect(mocks.listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50, limit: 50 })));
    expect(await screen.findByText('Showing 51–100 of 120')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Older' }));
    expect(await screen.findByText('Showing 101–120 of 120')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
  });

  it('says so when nothing matches', async () => {
    mocks.listAudit.mockResolvedValue(page([]));
    render(<Audit />);
    expect(await screen.findByText('Nothing recorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export this page' })).toBeDisabled();
  });

  it('exports the rows on screen', async () => {
    mocks.exportToExcel.mockResolvedValue();
    render(<Audit />);
    await screen.findByText('Updated Ahmed Khalil: designation');
    await userEvent.click(screen.getByRole('button', { name: 'Export this page' }));
    expect(mocks.exportToExcel).toHaveBeenCalledTimes(1);
    const { rows, fileName } = mocks.exportToExcel.mock.calls[0][0];
    expect(fileName).toBe('audit-trail');
    expect(rows).toHaveLength(2);
  });

  it('offers a retry when loading fails', async () => {
    mocks.listAudit.mockRejectedValueOnce(new Error('Server down'));
    render(<Audit />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Updated Ahmed Khalil: designation')).toBeInTheDocument();
  });
});
