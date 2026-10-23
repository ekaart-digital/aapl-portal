import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { NotificationsProvider, useNotifications } from './NotificationsContext';

const mocks = vi.hoisted(() => ({ getUnreadCount: vi.fn() }));
vi.mock('../api/notifications', () => ({ getUnreadCount: mocks.getUnreadCount }));

function Probe() {
  const { unreadCount, setUnreadCount } = useNotifications();
  return (
    <div>
      <span data-testid="count">{unreadCount}</span>
      <button onClick={() => setUnreadCount(0)}>clear</button>
    </div>
  );
}

const setHidden = (hidden) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });

describe('NotificationsProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getUnreadCount.mockReset();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  const mount = async () => {
    render(<NotificationsProvider><Probe /></NotificationsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  };

  it('loads the unread count when it mounts', async () => {
    mocks.getUnreadCount.mockResolvedValue(4);
    await mount();
    expect(screen.getByTestId('count')).toHaveTextContent('4');
  });

  it('polls every 30 seconds while the tab is visible', async () => {
    mocks.getUnreadCount.mockResolvedValueOnce(1).mockResolvedValue(6);
    await mount();
    expect(mocks.getUnreadCount).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(mocks.getUnreadCount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('count')).toHaveTextContent('6');
  });

  it('does not poll while the tab is hidden, and refreshes when it comes back', async () => {
    mocks.getUnreadCount.mockResolvedValue(2);
    await mount();
    mocks.getUnreadCount.mockClear();

    setHidden(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    expect(mocks.getUnreadCount).not.toHaveBeenCalled();

    mocks.getUnreadCount.mockResolvedValue(9);
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getUnreadCount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('count')).toHaveTextContent('9');
  });

  it('keeps the last count when a poll fails', async () => {
    mocks.getUnreadCount.mockResolvedValueOnce(3).mockRejectedValue(new Error('offline'));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByTestId('count')).toHaveTextContent('3');
  });

  it('lets screens update the count directly', async () => {
    mocks.getUnreadCount.mockResolvedValue(5);
    await mount();
    await act(async () => { screen.getByText('clear').click(); });
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('stops polling when it unmounts', async () => {
    mocks.getUnreadCount.mockResolvedValue(1);
    const { unmount } = render(<NotificationsProvider><Probe /></NotificationsProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    mocks.getUnreadCount.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(mocks.getUnreadCount).not.toHaveBeenCalled();
  });

  it('refuses to be used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/NotificationsProvider/);
    spy.mockRestore();
  });
});
