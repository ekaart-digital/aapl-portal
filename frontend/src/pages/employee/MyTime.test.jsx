import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyTime from './MyTime';

const mocks = vi.hoisted(() => ({
  listMySessions: vi.fn(),
  listMyRequests: vi.fn(),
  requestCorrection: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/corrections', () => ({
  listMySessions: mocks.listMySessions,
  listMyRequests: mocks.listMyRequests,
  requestCorrection: mocks.requestCorrection,
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const session = (over = {}) => ({
  id: 7, taskId: 1, taskName: 'Pipe stress analysis', projectId: 1, projectName: 'Saria Refinery', projectJobCode: 'T-001',
  logDate: '2026-10-05', durationMinutes: 480, autoStopped: false, adjusted: false, note: null, requestStatus: null,
  ...over,
});

const request = (over = {}) => ({
  id: 3, logId: 7, employeeId: 4, employeeName: 'Ahmed Khalil', taskName: 'Pipe stress analysis', projectId: 1, projectName: 'Saria Refinery',
  logDate: '2026-10-04', originalMinutes: 480, requestedMinutes: 360, reason: 'Forgot to stop', status: 'pending',
  reviewerName: null, reviewedAt: null, reviewNote: null, createdAt: '2026-10-05T09:00:00', ...over,
});

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.listMySessions.mockResolvedValue({ windowDays: 14, sessions: [session(), session({ id: 8, taskName: 'Layout', durationMinutes: 90 })] });
  mocks.listMyRequests.mockResolvedValue([]);
});

const rowOf = (text) => screen.getByText(text).closest('tr');

describe('My Time', () => {
  it('lists recent sessions with their recorded time', async () => {
    render(<MyTime />);
    const row = (await screen.findByText('Pipe stress analysis', { selector: '.cell-primary' })).closest('tr');
    expect(within(row).getByText('2026-10-05')).toBeInTheDocument();
    expect(within(row).getByText('8h 00m')).toBeInTheDocument();
    expect(within(rowOf('Layout')).getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText(/last 14 days/)).toBeInTheDocument();
  });

  it('marks sessions that were stopped automatically, adjusted, or have a request', async () => {
    mocks.listMySessions.mockResolvedValue({
      windowDays: 14,
      sessions: [
        session({ id: 1, taskName: 'Auto one', autoStopped: true }),
        session({ id: 2, taskName: 'Adjusted one', adjusted: true }),
        session({ id: 3, taskName: 'Waiting one', requestStatus: 'pending' }),
        session({ id: 4, taskName: 'Declined one', requestStatus: 'rejected' }),
      ],
    });
    render(<MyTime />);
    await screen.findByText('Auto one');
    expect(within(rowOf('Auto one')).getByText('Stopped automatically')).toBeInTheDocument();
    expect(within(rowOf('Adjusted one')).getByText('Adjusted')).toBeInTheDocument();
    expect(within(rowOf('Waiting one')).getByText('Waiting for a decision')).toBeInTheDocument();
    expect(within(rowOf('Declined one')).getByText('Not approved')).toBeInTheDocument();
  });

  it('cannot ask again while a request is waiting', async () => {
    mocks.listMySessions.mockResolvedValue({ windowDays: 14, sessions: [session({ requestStatus: 'pending' }), session({ id: 8, taskName: 'Layout' })] });
    render(<MyTime />);
    await screen.findByText('Layout');
    expect(within(rowOf('Pipe stress analysis')).getByRole('button', { name: 'Request correction' })).toBeDisabled();
    expect(within(rowOf('Layout')).getByRole('button', { name: 'Request correction' })).toBeEnabled();
  });

  it('sends a request with the new time and the reason, then refreshes', async () => {
    mocks.requestCorrection.mockResolvedValue(request());
    render(<MyTime />);
    await userEvent.click(within(await screen.findByText('Pipe stress analysis').then((el) => el.closest('tr'))).getByRole('button', { name: 'Request correction' }));

    // The form starts at the recorded time.
    expect(screen.getByLabelText('Hours')).toHaveValue(8);
    expect(screen.getByLabelText('Minutes')).toHaveValue(0);

    await userEvent.clear(screen.getByLabelText('Hours'));
    await userEvent.type(screen.getByLabelText('Hours'), '6');
    await userEvent.clear(screen.getByLabelText('Minutes'));
    await userEvent.type(screen.getByLabelText('Minutes'), '30');
    await userEvent.type(screen.getByPlaceholderText(/forgot to stop/i), 'I left at 2:30pm');
    mocks.listMySessions.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(mocks.requestCorrection).toHaveBeenCalledWith({ logId: 7, durationMinutes: 390, reason: 'I left at 2:30pm' }));
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/request sent/i));
    await waitFor(() => expect(mocks.listMySessions).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
  });

  it('checks the form before sending', async () => {
    render(<MyTime />);
    await userEvent.click(within(await screen.findByText('Pipe stress analysis').then((el) => el.closest('tr'))).getByRole('button', { name: 'Request correction' }));

    // Unchanged time.
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/already recorded/);

    // No reason.
    await userEvent.clear(screen.getByLabelText('Hours'));
    await userEvent.type(screen.getByLabelText('Hours'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/why the time should change/);

    // Minutes out of range.
    await userEvent.clear(screen.getByLabelText('Minutes'));
    await userEvent.type(screen.getByLabelText('Minutes'), '75');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/minutes 0 to 59/);

    // Longer than a day.
    await userEvent.clear(screen.getByLabelText('Hours'));
    await userEvent.type(screen.getByLabelText('Hours'), '25');
    await userEvent.clear(screen.getByLabelText('Minutes'));
    await userEvent.type(screen.getByLabelText('Minutes'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/24 hours/);

    expect(mocks.requestCorrection).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when a request is refused, and keeps the form open', async () => {
    mocks.requestCorrection.mockRejectedValue(new Error('This session already has a request waiting for a decision.'));
    render(<MyTime />);
    await userEvent.click(within(await screen.findByText('Layout').then((el) => el.closest('tr'))).getByRole('button', { name: 'Request correction' }));
    await userEvent.clear(screen.getByLabelText('Hours'));
    await userEvent.type(screen.getByLabelText('Hours'), '2');
    await userEvent.type(screen.getByPlaceholderText(/forgot to stop/i), 'More time please');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already has a request');
    expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
  });

  it('lists my requests with the decision and the reviewer’s note', async () => {
    mocks.listMyRequests.mockResolvedValue([
      request({ id: 1, status: 'approved', reviewerName: 'Hilal Al-Siyabi', reviewNote: 'Agreed' }),
      request({ id: 2, status: 'rejected', reason: 'Want less', reviewerName: 'Khalid Al-Rawahi', reviewNote: 'The timer shows otherwise' }),
      request({ id: 3, status: 'pending', reason: 'Still waiting' }),
    ]);
    render(<MyTime />);
    await screen.findByText('My requests');
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Hilal Al-Siyabi: Agreed')).toBeInTheDocument();
    expect(screen.getByText('Khalid Al-Rawahi: The timer shows otherwise')).toBeInTheDocument();
    expect(screen.getAllByText('8h 00m → 6h 00m')).toHaveLength(3);
  });

  it('offers a retry when loading fails', async () => {
    mocks.listMySessions.mockRejectedValueOnce(new Error('Server down'));
    render(<MyTime />);
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Layout')).toBeInTheDocument();
  });
});
