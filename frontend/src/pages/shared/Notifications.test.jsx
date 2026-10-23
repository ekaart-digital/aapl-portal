import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Notifications from './Notifications';

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  setUnreadCount: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../../api/notifications', () => ({
  listNotifications: mocks.listNotifications,
  markRead: mocks.markRead,
  markAllRead: mocks.markAllRead,
}));
vi.mock('../../context/NotificationsContext', () => ({
  useNotifications: () => ({ setUnreadCount: mocks.setUnreadCount, unreadCount: 0 }),
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ pushToast: mocks.pushToast }) }));

const note = (id, over = {}) => ({
  id, type: 'task-assigned', severity: 'info', title: `Title ${id}`, body: `Body ${id}`,
  link: '/my-tasks', read: false, ageSeconds: 120, ...over,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/my-tasks" element={<div>My tasks page</div>} />
        <Route path="/projects/:id" element={<div>Project page</div>} />
        <Route path="/reports" element={<div>Reports page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Notifications page', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
    mocks.listNotifications.mockResolvedValue({
      notifications: [
        note(3, { severity: 'critical', title: 'Project has used all its estimated man-hours', link: '/projects/7' }),
        note(2, { severity: 'attention', title: 'A task was put on hold', read: true, ageSeconds: 7200 }),
        note(1, { title: 'New task assigned', ageSeconds: 90000, link: null }),
      ],
      hasMore: false,
      unreadCount: 2,
    });
    mocks.markRead.mockResolvedValue(1);
    mocks.markAllRead.mockResolvedValue(0);
  });

  it('lists notifications with severity, text and how long ago', async () => {
    renderPage();
    const list = await screen.findByTestId('notification-list');
    expect(within(list).getByText('Project has used all its estimated man-hours')).toBeInTheDocument();
    expect(within(list).getByText('Critical')).toBeInTheDocument();
    expect(within(list).getByText('Attention')).toBeInTheDocument();
    expect(within(list).getByText('Info')).toBeInTheDocument();
    expect(within(list).getByText('2 minutes ago')).toBeInTheDocument();
    expect(within(list).getByText('2 hours ago')).toBeInTheDocument();
    expect(within(list).getByText('yesterday')).toBeInTheDocument();
  });

  it('marks unread ones visibly, and reports the server’s count to the bell', async () => {
    renderPage();
    const list = await screen.findByTestId('notification-list');
    expect(within(list).getAllByLabelText('Unread')).toHaveLength(2);
    expect(mocks.setUnreadCount).toHaveBeenCalledWith(2);
  });

  it('opening one marks it read and goes to what it is about', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('Project has used all its estimated man-hours'));

    expect(mocks.markRead).toHaveBeenCalledWith(3);
    expect(await screen.findByText('Project page')).toBeInTheDocument();
    await waitFor(() => expect(mocks.setUnreadCount).toHaveBeenLastCalledWith(1));
  });

  it('opening one that is already read does not call the server to mark it', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('A task was put on hold'));
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(await screen.findByText('My tasks page')).toBeInTheDocument();
  });

  it('a notification without a link is marked read but goes nowhere', async () => {
    renderPage();
    await userEvent.click(await screen.findByText('New task assigned'));
    expect(mocks.markRead).toHaveBeenCalledWith(1);
    expect(screen.queryByText('My tasks page')).not.toBeInTheDocument();
    expect(screen.getByText('Notifications', { selector: 'h1' })).toBeInTheDocument();
  });

  it('mark all as read clears them and resets the bell', async () => {
    renderPage();
    await screen.findByTestId('notification-list');
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(mocks.markAllRead).toHaveBeenCalled());
    expect(mocks.setUnreadCount).toHaveBeenLastCalledWith(0);
    expect(screen.queryAllByLabelText('Unread')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('mark all as read is disabled when nothing is unread', async () => {
    mocks.listNotifications.mockResolvedValue({ notifications: [note(1, { read: true })], hasMore: false, unreadCount: 0 });
    renderPage();
    await screen.findByTestId('notification-list');
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  it('the Unread tab asks the server for unread only', async () => {
    renderPage();
    await screen.findByTestId('notification-list');
    mocks.listNotifications.mockClear();
    mocks.listNotifications.mockResolvedValue({ notifications: [note(3)], hasMore: false, unreadCount: 1 });

    await userEvent.click(screen.getByText('Unread', { selector: '.tab-item' }));
    await waitFor(() => expect(mocks.listNotifications).toHaveBeenCalledWith(expect.objectContaining({ unread: true })));
  });

  it('shows friendly empty states', async () => {
    mocks.listNotifications.mockResolvedValue({ notifications: [], hasMore: false, unreadCount: 0 });
    renderPage();
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Unread', { selector: '.tab-item' }));
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
  });

  it('loads older notifications with the cursor of the last one shown', async () => {
    mocks.listNotifications.mockResolvedValueOnce({ notifications: [note(5), note(4)], hasMore: true, unreadCount: 2 });
    renderPage();
    await screen.findByText('Title 4');

    mocks.listNotifications.mockResolvedValueOnce({ notifications: [note(3), note(2)], hasMore: false, unreadCount: 2 });
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(mocks.listNotifications).toHaveBeenLastCalledWith(expect.objectContaining({ before: 4 })));
    expect(await screen.findByText('Title 2')).toBeInTheDocument();
    expect(screen.getByText('Title 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    mocks.listNotifications.mockRejectedValueOnce(new Error('Could not reach the server.'));
    renderPage();
    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('notification-list')).toBeInTheDocument();
  });

  it('can be used from the keyboard', async () => {
    renderPage();
    const row = (await screen.findByText('New task assigned')).closest('[role="button"]');
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(mocks.markRead).toHaveBeenCalledWith(1);
  });
});
