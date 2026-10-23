import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyTasks from './MyTasks';
import { employee, makeTask } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  listMyTasks: vi.fn(),
  getMyOpenSession: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  updateTask: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/tasks', () => ({
  listMyTasks: mocks.listMyTasks,
  getMyOpenSession: mocks.getMyOpenSession,
  startTimer: mocks.startTimer,
  stopTimer: mocks.stopTimer,
  updateTask: mocks.updateTask,
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: employee }) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const sessionInfo = (openSession = null, autoStoppedSession = null, maxSessionMinutes = 720) => (
  { openSession, autoStoppedSession, maxSessionMinutes }
);

const taskRow = (name) => screen.getByText(name).closest('div[style*="padding: 14px"]');

async function renderPage({ tasks, openSession = null, autoStoppedSession = null }) {
  mocks.listMyTasks.mockResolvedValue(tasks);
  mocks.getMyOpenSession.mockResolvedValue(sessionInfo(openSession, autoStoppedSession));
  const utils = render(<MyTasks />);
  await screen.findByText('Assigned Tasks');
  return utils;
}

const openLog = (over = {}) => ({ id: 77, taskId: 10, employeeId: 4, isOpen: true, elapsedSeconds: 0, ...over });

describe('MyTasks', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });
  afterEach(() => vi.useRealTimers());

  it('lists open tasks and hides completed ones until asked', async () => {
    await renderPage({
      tasks: [
        makeTask({ id: 10, taskName: 'Open task' }),
        makeTask({ id: 11, taskName: 'Finished task', status: 'Completed' }),
      ],
    });
    expect(screen.getByText('Open task')).toBeInTheDocument();
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/show completed \(1\)/i));
    expect(screen.getByText('Finished task')).toBeInTheDocument();
  });

  it('shows a task’s category beside its project and department, and nothing when it has none', async () => {
    await renderPage({
      tasks: [
        makeTask({ id: 10, taskName: 'Categorised task', category: 'Calculation' }),
        makeTask({ id: 11, taskName: 'Plain task', category: null }),
      ],
    });
    expect(screen.getByText(/Saria Refinery · Piping · Input Study · Calculation/)).toBeInTheDocument();
    expect(screen.getByText('Saria Refinery · Piping · Input Study')).toBeInTheDocument();
  });

  it('never lets a completed task be started', async () => {
    await renderPage({ tasks: [makeTask({ id: 11, taskName: 'Finished task', status: 'Completed' })] });
    await userEvent.click(screen.getByLabelText(/show completed/i));
    expect(within(taskRow('Finished task')).getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('shows hours done against the allocation', async () => {
    await renderPage({ tasks: [makeTask({ completedHours: 2.5, allocatedHours: 10 })] });
    expect(screen.getByText('2.5h / 10h')).toBeInTheDocument();
  });

  it('start calls the API, switches to Stop and shows the running clock', async () => {
    mocks.startTimer.mockResolvedValue(openLog());
    await renderPage({ tasks: [makeTask({ id: 10 })] });

    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(mocks.startTimer).toHaveBeenCalledWith(10);
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument();
    expect(screen.getByText('00:00:00')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(mocks.pushToast).toHaveBeenCalledWith(expect.stringMatching(/timer started/i));
  });

  it('shows the server message when a timer cannot be started', async () => {
    mocks.startTimer.mockRejectedValue(new Error('You already have a running timer on task #3.'));
    await renderPage({ tasks: [makeTask({ id: 10 })] });

    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('You already have a running timer on task #3.'));
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('restores a running timer after a refresh, using the server’s elapsed seconds', async () => {
    await renderPage({
      tasks: [makeTask({ id: 10, taskName: 'Running one' }), makeTask({ id: 12, taskName: 'Other one' })],
      openSession: openLog({ taskId: 10, elapsedSeconds: 90 }),
    });

    expect(screen.getByText('00:01:30')).toBeInTheDocument();
    expect(within(taskRow('Running one')).getByRole('button', { name: /stop/i })).toBeInTheDocument();
    expect(within(taskRow('Other one')).getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('live hours include the running session in hours, not minutes', async () => {
    // 0.5h already logged + 30 min running = 1h. The old bug mixed minutes into hours.
    await renderPage({
      tasks: [makeTask({ id: 10, completedHours: 0.5, allocatedHours: 10 })],
      openSession: openLog({ taskId: 10, elapsedSeconds: 1800 }),
    });
    expect(screen.getByText('1h / 10h')).toBeInTheDocument();
  });

  it('keeps the clock correct from real time even if ticks are throttled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    mocks.listMyTasks.mockResolvedValue([makeTask({ id: 10 })]);
    mocks.getMyOpenSession.mockResolvedValue(sessionInfo(openLog({ taskId: 10, elapsedSeconds: 0 })));
    render(<MyTasks />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText('00:00:00')).toBeInTheDocument();

    // A background tab runs one tick after five minutes have passed.
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(screen.getByText('00:05:00')).toBeInTheDocument();
  });

  it('stop sends the open session ID, then refreshes the hours', async () => {
    mocks.stopTimer.mockResolvedValue({ id: 77, durationMinutes: 42, isOpen: false });
    mocks.listMyTasks
      .mockResolvedValueOnce([makeTask({ id: 10, completedHours: 0 })])
      .mockResolvedValueOnce([makeTask({ id: 10, completedHours: 0.7, status: 'In Progress' })]);
    mocks.getMyOpenSession.mockResolvedValue(sessionInfo(openLog({ id: 77, taskId: 10, elapsedSeconds: 5 })));
    render(<MyTasks />);
    await userEvent.click(await screen.findByRole('button', { name: /stop/i }));

    expect(mocks.stopTimer).toHaveBeenCalledWith(10, 77);
    expect(await screen.findByText('0.7h / 10h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeEnabled();
    expect(mocks.pushToast).toHaveBeenCalledWith('Logged 42 min on Pipe stress analysis.');
  });

  it('cannot update the task whose timer is running', async () => {
    await renderPage({ tasks: [makeTask({ id: 10, taskName: 'Running one' })], openSession: openLog({ taskId: 10 }) });
    expect(within(taskRow('Running one')).getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('update saves the new status and remarks', async () => {
    const updated = makeTask({ id: 10, status: 'On Hold', remarks: 'Waiting for client' });
    mocks.updateTask.mockResolvedValue(updated);
    await renderPage({ tasks: [makeTask({ id: 10 })] });

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    const dialog = screen.getByText('Update task').closest('.modal-panel') || document.body;
    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'On Hold');
    await userEvent.type(within(dialog).getByPlaceholderText(/awaiting client input/i), 'Waiting for client');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mocks.updateTask).toHaveBeenCalledWith(10, { status: 'On Hold', remarks: 'Waiting for client' });
    expect(await screen.findByText('Remarks: Waiting for client')).toBeInTheDocument();
    expect(screen.getByText('On Hold')).toBeInTheDocument();
  });

  it('shows the server message and keeps the dialog open when an update is refused', async () => {
    mocks.updateTask.mockRejectedValue(new Error('Stop the running timer on this task before changing its status.'));
    await renderPage({ tasks: [makeTask({ id: 10 })] });

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Stop the running timer on this task before changing its status.'));
    expect(screen.getByText('Update task')).toBeInTheDocument();
  });

  it('tells the employee when a forgotten timer was stopped for them, and can be dismissed', async () => {
    await renderPage({
      tasks: [makeTask({ id: 10 })],
      autoStoppedSession: { id: 5, taskName: 'Pipe stress analysis', logDate: '2026-10-04', durationMinutes: 720 },
    });
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('left running and was stopped automatically after 12h 00m');
    expect(notice).toHaveTextContent('Pipe stress analysis');
    expect(notice).toHaveTextContent('your manager will review it');

    await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows no notice when nothing was auto-stopped', async () => {
    await renderPage({ tasks: [makeTask({ id: 10 })] });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not warn on an ordinary running timer', async () => {
    await renderPage({ tasks: [makeTask({ id: 10 })], openSession: openLog({ taskId: 10, elapsedSeconds: 2 * 3600 }) });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns as a timer approaches the 12 hour limit', async () => {
    await renderPage({ tasks: [makeTask({ id: 10 })], openSession: openLog({ taskId: 10, elapsedSeconds: 9 * 3600 }) });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('running for 9h 00m');
    expect(alert).toHaveTextContent('limited to 12h 00m');
    expect(alert).not.toHaveClass('danger');
  });

  it('shows a stronger message once the limit has passed', async () => {
    await renderPage({ tasks: [makeTask({ id: 10 })], openSession: openLog({ taskId: 10, elapsedSeconds: 13 * 3600 }) });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('has passed 12h 00m');
    expect(alert).toHaveTextContent('Only 12h 00m will be recorded');
    expect(alert).toHaveClass('danger');
  });

  it('uses the limit the server reports', async () => {
    mocks.listMyTasks.mockResolvedValue([makeTask({ id: 10 })]);
    mocks.getMyOpenSession.mockResolvedValue(sessionInfo(openLog({ taskId: 10, elapsedSeconds: 7 * 3600 }), null, 8 * 60));
    render(<MyTasks />);
    expect(await screen.findByRole('alert')).toHaveTextContent('limited to 8h 00m');
  });

  it('explains it when a stopped timer was capped and flagged for review', async () => {
    mocks.stopTimer.mockResolvedValue({ id: 77, durationMinutes: 720, autoStopped: true, isOpen: false });
    mocks.listMyTasks.mockResolvedValue([makeTask({ id: 10 })]);
    mocks.getMyOpenSession.mockResolvedValue(sessionInfo(openLog({ id: 77, taskId: 10, elapsedSeconds: 30 * 3600 })));
    render(<MyTasks />);
    await userEvent.click(await screen.findByRole('button', { name: /stop/i }));

    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith(
      'That timer ran past 12h 00m. 12h 00m was recorded and flagged for your manager to review.'
    ));
  });

  it('offers a retry when the tasks cannot be loaded', async () => {
    mocks.listMyTasks.mockRejectedValueOnce(new Error('Could not reach the server.'));
    mocks.getMyOpenSession.mockResolvedValue(sessionInfo(null));
    render(<MyTasks />);
    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();

    mocks.listMyTasks.mockResolvedValue([makeTask({ taskName: 'Back again' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Back again')).toBeInTheDocument();
  });
});
