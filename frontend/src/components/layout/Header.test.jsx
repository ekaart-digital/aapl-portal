import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Header from './Header';
import { employee } from '../../test/fixtures';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  pushToast: vi.fn(),
  setUnreadCount: vi.fn(),
  unreadCount: 0,
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: employee, logout: mocks.logout }) }));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));
vi.mock('../../context/NotificationsContext', () => ({
  useNotifications: () => ({ unreadCount: mocks.unreadCount, setUnreadCount: mocks.setUnreadCount }),
}));
vi.mock('../../api/notifications', () => ({
  listNotifications: mocks.listNotifications,
  markRead: mocks.markRead,
  markAllRead: mocks.markAllRead,
}));
vi.mock('../../api/auth', () => ({ changePassword: mocks.changePassword }));

const note = (id, over = {}) => ({
  id, type: 't', severity: 'info', title: `Title ${id}`, body: `Body ${id}`,
  link: '/my-tasks', read: false, ageSeconds: 30, ...over,
});

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/my-progress']}>
      <Header onMenuClick={() => {}} />
      <Routes>
        <Route path="/my-tasks" element={<div>My tasks page</div>} />
        <Route path="/notifications" element={<div>Notifications page</div>} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });

describe('Header — notification bell', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
    mocks.unreadCount = 0;
    mocks.listNotifications.mockResolvedValue({ notifications: [note(2), note(1, { read: true })], hasMore: false, unreadCount: 1 });
    mocks.markRead.mockResolvedValue(0);
    mocks.markAllRead.mockResolvedValue(0);
  });

  it('shows no badge when everything is read', () => {
    renderHeader();
    expect(bell()).toHaveAccessibleName('Notifications');
    expect(document.querySelector('.count-badge')).toBeNull();
  });

  it('shows the unread count on the bell, and announces it', () => {
    mocks.unreadCount = 4;
    renderHeader();
    expect(bell()).toHaveAccessibleName('Notifications, 4 unread');
    expect(document.querySelector('.count-badge')).toHaveTextContent('4');
  });

  it('caps a large count at 99+', () => {
    mocks.unreadCount = 250;
    renderHeader();
    expect(document.querySelector('.count-badge')).toHaveTextContent('99+');
  });

  it('opening the panel fetches the latest few and syncs the count', async () => {
    renderHeader();
    await userEvent.click(bell());

    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(mocks.listNotifications).toHaveBeenCalledWith({ limit: 6 });
    expect(await within(panel).findByText('Title 2')).toBeInTheDocument();
    expect(within(panel).getByText('Title 1')).toBeInTheDocument();
    expect(mocks.setUnreadCount).toHaveBeenCalledWith(1);
  });

  it('clicking the bell again closes the panel', async () => {
    renderHeader();
    await userEvent.click(bell());
    await screen.findByRole('dialog', { name: 'Notifications' });
    await userEvent.click(bell());
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('shows a message when there are none, and when loading fails', async () => {
    mocks.listNotifications.mockResolvedValueOnce({ notifications: [], hasMore: false, unreadCount: 0 });
    renderHeader();
    await userEvent.click(bell());
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument();

    await userEvent.click(bell());
    mocks.listNotifications.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(bell());
    expect(await screen.findByText(/couldn't load notifications/i)).toBeInTheDocument();
  });

  it('clicking an item marks it read, goes to it and closes the panel', async () => {
    renderHeader();
    await userEvent.click(bell());
    await userEvent.click(await screen.findByText('Title 2'));

    expect(mocks.markRead).toHaveBeenCalledWith(2);
    expect(await screen.findByText('My tasks page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.setUnreadCount).toHaveBeenLastCalledWith(0));
  });

  it('an already-read item just navigates', async () => {
    renderHeader();
    await userEvent.click(bell());
    await userEvent.click(await screen.findByText('Title 1'));
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(await screen.findByText('My tasks page')).toBeInTheDocument();
  });

  it('"Mark all read" only appears with unread items and clears them', async () => {
    mocks.unreadCount = 1;
    renderHeader();
    await userEvent.click(bell());
    await userEvent.click(await screen.findByText('Mark all read'));

    await waitFor(() => expect(mocks.markAllRead).toHaveBeenCalled());
    expect(mocks.setUnreadCount).toHaveBeenLastCalledWith(0);
    expect(within(screen.getByRole('dialog')).queryAllByLabelText('Unread')).toHaveLength(0);
  });

  it('hides "Mark all read" when nothing is unread', async () => {
    renderHeader();
    await userEvent.click(bell());
    await screen.findByText('Title 2');
    expect(screen.queryByText('Mark all read')).not.toBeInTheDocument();
  });

  it('"View all" opens the full page', async () => {
    renderHeader();
    await userEvent.click(bell());
    await userEvent.click(await screen.findByText('View all'));
    expect(await screen.findByText('Notifications page')).toBeInTheDocument();
  });

  it('opening the user menu closes the notification panel', async () => {
    renderHeader();
    await userEvent.click(bell());
    await screen.findByRole('dialog', { name: 'Notifications' });
    await userEvent.click(screen.getByRole('button', { name: /Ahmed Khalil/ }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });
});

describe('Header — user menu', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => typeof m?.mockReset === 'function' && m.mockReset());
    mocks.unreadCount = 0;
  });

  it('logs out and returns to the sign-in page', async () => {
    renderHeader();
    await userEvent.click(screen.getByRole('button', { name: /Ahmed Khalil/ }));
    await userEvent.click(screen.getByText('Log out'));
    expect(mocks.logout).toHaveBeenCalled();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  async function openPasswordDialog() {
    renderHeader();
    await userEvent.click(screen.getByRole('button', { name: /Ahmed Khalil/ }));
    await userEvent.click(screen.getByText('Change password', { selector: '.role-menu-item' }));
    return screen.getByText('Change password', { selector: 'h3' }).closest('.modal-panel');
  }

  it('change password: checks the fields before calling the server', async () => {
    const dialog = await openPasswordDialog();
    const [current, next, confirm] = dialog.querySelectorAll('input[type="password"]');
    const save = within(dialog).getByRole('button', { name: 'Change password' });

    await userEvent.click(save);
    expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/enter your current and new password/i));

    await userEvent.type(current, 'Passw0rd!');
    await userEvent.type(next, 'short');
    await userEvent.click(save);
    expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/at least 8 characters/i));

    await userEvent.clear(next);
    await userEvent.type(next, 'LongEnough1');
    await userEvent.type(confirm, 'Different1');
    await userEvent.click(save);
    expect(mocks.pushToast).toHaveBeenLastCalledWith(expect.stringMatching(/do not match/i));
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('change password: saves and closes on success', async () => {
    mocks.changePassword.mockResolvedValue({ ok: true });
    const dialog = await openPasswordDialog();
    const [current, next, confirm] = dialog.querySelectorAll('input[type="password"]');
    await userEvent.type(current, 'Passw0rd!');
    await userEvent.type(next, 'LongEnough1');
    await userEvent.type(confirm, 'LongEnough1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith('Passw0rd!', 'LongEnough1'));
    expect(mocks.pushToast).toHaveBeenCalledWith('Password changed.');
    await waitFor(() => expect(screen.queryByText('Change password', { selector: 'h3' })).not.toBeInTheDocument());
  });

  it('change password: shows the server’s message when it is refused', async () => {
    mocks.changePassword.mockRejectedValue(new Error('Current password is incorrect.'));
    const dialog = await openPasswordDialog();
    const [current, next, confirm] = dialog.querySelectorAll('input[type="password"]');
    await userEvent.type(current, 'wrong');
    await userEvent.type(next, 'LongEnough1');
    await userEvent.type(confirm, 'LongEnough1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith('Current password is incorrect.'));
    expect(screen.getByText('Change password', { selector: 'h3' })).toBeInTheDocument();
  });
});
