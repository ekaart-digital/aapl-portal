import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Admin from './Admin';

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  listSettings: vi.fn(),
  saveSettings: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/system', () => ({
  getHealth: mocks.getHealth,
  listSettings: mocks.listSettings,
  saveSettings: mocks.saveSettings,
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const health = (over = {}) => ({
  status: 'ok', checkedAt: '2026-10-06T08:00:00', version: '1.0.0', environment: 'production', uptimeSeconds: 93784, node: 'v22.1.0',
  database: { ok: true, latencyMs: 12, error: null },
  jobs: { startedAt: '2026-10-05T06:00:00', lastSweepAt: '2026-10-06T07:55:00', lastSweepStopped: 2, lastSweepError: null, lastDailyAt: '2026-10-06T07:00:00', lastDailyError: null },
  counts: {
    activePeople: 35, inactivePeople: 2, activeProjects: 4, openTasks: 27, runningTimers: 3, unreviewedSessions: 1,
    pendingCorrections: 2, auditEntriesToday: 18, failedLoginsToday: 0,
    peopleByRole: [{ role: 'employee', label: 'Employee', count: 24 }, { role: 'system_admin', label: 'System Administrator', count: 1 }],
  },
  ...over,
});

const setting = (over = {}) => ({
  key: 'maxSessionHours', label: 'Longest timer session', description: 'A timer left running longer is stopped.', unit: 'hours',
  min: 1, max: 24, step: 1, default: 12, value: 12, isDefault: true, updatedAt: null, updatedByName: null, ...over,
});

const settingsList = () => [
  setting(),
  setting({ key: 'correctionWindowDays', label: 'Correction request window', unit: 'days', min: 1, max: 90, default: 14, value: 21, isDefault: false, updatedByName: 'Platform Administrator' }),
];

const renderPage = () => render(<MemoryRouter><Admin /></MemoryRouter>);

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getHealth.mockResolvedValue(health());
  mocks.listSettings.mockResolvedValue(settingsList());
});

describe('Administration: health', () => {
  it('shows the state of the system', async () => {
    renderPage();
    expect(await screen.findByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('12 ms')).toBeInTheDocument();
    expect(screen.getByText('1d 2h')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0 · production')).toBeInTheDocument();
    const stat = (label) => screen.getByText(label).closest('.stat-card');
    expect(within(stat('Active People')).getByText('35')).toBeInTheDocument();
    expect(within(stat('Running Timers')).getByText('3')).toBeInTheDocument();
  });

  it('shows what needs attention and the accounts by role', async () => {
    renderPage();
    await screen.findByText('Healthy');
    const detail = (label) => screen.getByText(label).closest('.detail-row');
    expect(within(detail('Sessions waiting for review')).getByText('1')).toBeInTheDocument();
    expect(within(detail('Correction requests pending')).getByText('2')).toBeInTheDocument();
    expect(within(detail('Changes recorded today')).getByRole('link', { name: '18' })).toHaveAttribute('href', '/audit');
    expect(screen.getByText('Employee: 24')).toBeInTheDocument();
    expect(screen.getByText('System Administrator: 1')).toBeInTheDocument();
  });

  it('flags a degraded system and a database that is down', async () => {
    mocks.getHealth.mockResolvedValue(health({
      status: 'degraded',
      database: { ok: false, latencyMs: null, error: 'connect ECONNREFUSED' },
      jobs: { ...health().jobs, lastSweepError: 'Timer sweep failed' },
    }));
    renderPage();
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
    expect(screen.getByText('connect ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Timer sweep failed');
  });

  it('says "Not yet" for jobs that have not run', async () => {
    mocks.getHealth.mockResolvedValue(health({ jobs: { ...health().jobs, lastSweepAt: null, lastDailyAt: null } }));
    renderPage();
    await screen.findByText('Healthy');
    expect(screen.getAllByText('Not yet')).toHaveLength(2);
  });

  it('offers a retry when loading fails', async () => {
    mocks.getHealth.mockRejectedValueOnce(new Error('Server down'));
    renderPage();
    expect(await screen.findByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Healthy')).toBeInTheDocument();
  });
});

describe('Administration: settings', () => {
  async function openSettings() {
    renderPage();
    await screen.findByText('Healthy');
    await userEvent.click(screen.getByText('Settings'));
    await screen.findByText('System settings');
  }

  it('shows each setting with its value, range, and whether it was changed', async () => {
    await openSettings();
    expect(screen.getByLabelText('Longest timer session')).toHaveValue(12);
    expect(screen.getByLabelText('Correction request window')).toHaveValue(21);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Changed by Platform Administrator')).toBeInTheDocument();
    expect(screen.getByText(/Allowed: 1–24 hours. Default: 12./)).toBeInTheDocument();
  });

  it('cannot save until something changes, then saves only what changed', async () => {
    await openSettings();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('Longest timer session'));
    await userEvent.type(screen.getByLabelText('Longest timer session'), '10');
    const save = screen.getByRole('button', { name: 'Save 1 change' });
    expect(save).toBeEnabled();

    mocks.saveSettings.mockResolvedValue({ settings: [setting({ value: 10, isDefault: false, updatedByName: 'Platform Administrator' }), settingsList()[1]], changed: ['maxSessionHours'] });
    await userEvent.click(save);
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ maxSessionHours: 10 }));
    expect(mocks.pushToast).toHaveBeenCalledWith('Settings saved.');
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByLabelText('Longest timer session')).toHaveValue(10);
  });

  it('checks the range before sending', async () => {
    await openSettings();
    await userEvent.clear(screen.getByLabelText('Longest timer session'));
    await userEvent.type(screen.getByLabelText('Longest timer session'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 24 hours');

    await userEvent.clear(screen.getByLabelText('Longest timer session'));
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 24 hours');
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('shows the server’s message when it refuses a value', async () => {
    await openSettings();
    await userEvent.clear(screen.getByLabelText('Longest timer session'));
    await userEvent.type(screen.getByLabelText('Longest timer session'), '8');
    mocks.saveSettings.mockRejectedValue(new Error('The man-hour warning level must be lower than the man-hour limit.'));
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('must be lower than');
    expect(screen.getByLabelText('Longest timer session')).toHaveValue(8); // kept for correction
  });
});
