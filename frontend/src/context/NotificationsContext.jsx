import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as notificationsApi from '../api/notifications';

const NotificationsCtx = createContext(null);

const POLL_INTERVAL_MS = 30000;

// Keeps the unread count fresh for the bell. It polls while the tab is visible
// and refreshes when the user comes back to it.
export function NotificationsProvider({ children }) {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setUnreadCount(await notificationsApi.getUnreadCount());
    } catch {
      /* keep the last known count; the next poll will try again */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, POLL_INTERVAL_MS);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const value = { unreadCount, setUnreadCount, refresh };
  return <NotificationsCtx.Provider value={value}>{children}</NotificationsCtx.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsCtx);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
