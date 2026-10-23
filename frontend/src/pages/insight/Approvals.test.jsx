import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Approvals from './Approvals';

const mocks = vi.hoisted(() => ({
  listForReview: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/corrections', () => ({
  listForReview: mocks.listForReview,
  approveRequest: mocks.approveRequest,
  rejectRequest: mocks.rejectRequest,
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const request = (over = {}) => ({
  id: 3, logId: 7, employeeId: 4, employeeName: 'Ahmed Khalil', taskName: 'Pipe stress analysis', projectId: 1, projectName: 'Saria Refinery',
  logDate: '2026-10-04', originalMinutes: 480, requestedMinutes: 360, reason: 'Forgot to stop for lunch', status: 'pending',
  reviewerName: null, reviewedAt: null, reviewNote: null, createdAt: '2026-10-05T09:00:00', ...over,
});

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.listForReview.mockResolvedValue([request(), request({ id: 4, employeeName: 'Vivek Rao', taskName: 'Layout', reason: 'Timer left on' })]);
  mocks.approveRequest.mockResolvedValue(request({ status: 'approved' }));
  mocks.rejectRequest.mockResolvedValue(request({ status: 'rejected' }));
});

const rowOf = (text) => screen.getByText(text).closest('tr');
const dialog = () => document.querySelector('.modal-panel');

describe('Approvals', () => {
  it('lists the requests waiting for me, with the change and the reason', async () => {
    render(<Approvals />);
    const row = (await screen.findByText('Ahmed Khalil')).closest('tr');
    expect(within(row).getByText('Pipe stress analysis')).toBeInTheDocument();
    expect(within(row).getByText('8h 00m → 6h 00m')).toBeInTheDocument();
    expect(within(row).getByText('Forgot to stop for lunch')).toBeInTheDocument();
    expect(mocks.listForReview).toHaveBeenCalledWith('pending');
  });

  it('approves a request, with an optional note, and refreshes the list', async () => {
    render(<Approvals />);
    await userEvent.click(within(await screen.findByText('Ahmed Khalil').then((el) => el.closest('tr'))).getByRole('button', { name: 'Approve' }));
    expect(within(dialog()).getByText('Approve this correction')).toBeInTheDocument();
    expect(within(dialog()).getByText('“Forgot to stop for lunch”')).toBeInTheDocument();
    await userEvent.type(within(dialog()).getByRole('textbox'), 'Fine');
    mocks.listForReview.mockClear();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.approveRequest).toHaveBeenCalledWith(3, 'Fine'));
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/approved/i));
    await waitFor(() => expect(mocks.listForReview).toHaveBeenCalled());
    expect(dialog()).toBeNull();
  });

  it('approves without a note', async () => {
    render(<Approvals />);
    await userEvent.click(within(await screen.findByText('Vivek Rao').then((el) => el.closest('tr'))).getByRole('button', { name: 'Approve' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.approveRequest).toHaveBeenCalledWith(4, ''));
  });

  it('will not decline without an explanation', async () => {
    render(<Approvals />);
    await userEvent.click(within(await screen.findByText('Ahmed Khalil').then((el) => el.closest('tr'))).getByRole('button', { name: 'Decline' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Decline' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(/explain why/i);
    expect(mocks.rejectRequest).not.toHaveBeenCalled();

    await userEvent.type(within(dialog()).getByRole('textbox'), 'The timer shows you worked');
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(mocks.rejectRequest).toHaveBeenCalledWith(3, 'The timer shows you worked'));
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/declined/i));
  });

  it('shows the server’s reason if the decision cannot be saved, and keeps the dialog open', async () => {
    mocks.approveRequest.mockRejectedValue(new Error('This session was changed after the request was made.'));
    render(<Approvals />);
    await userEvent.click(within(await screen.findByText('Ahmed Khalil').then((el) => el.closest('tr'))).getByRole('button', { name: 'Approve' }));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('changed after the request');
  });

  it('shows past decisions on the All requests tab', async () => {
    mocks.listForReview.mockImplementation(async (status) => (status === 'all'
      ? [request({ id: 9, status: 'approved', reviewerName: 'Hilal Al-Siyabi', reviewNote: 'Agreed' }), request()]
      : []));
    render(<Approvals />);
    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument();
    await userEvent.click(screen.getByText('All requests'));
    expect(await screen.findByText('Hilal Al-Siyabi: Agreed')).toBeInTheDocument();
    expect(mocks.listForReview).toHaveBeenLastCalledWith('all');
    // Pending ones keep their buttons.
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
  });

  it('offers a retry when loading fails', async () => {
    mocks.listForReview.mockRejectedValueOnce(new Error('Server down'));
    render(<Approvals />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Ahmed Khalil')).toBeInTheDocument();
  });
});
