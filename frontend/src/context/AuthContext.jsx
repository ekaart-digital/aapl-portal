import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as authApi from '../api/auth';
import { getToken, setToken, setUnauthorizedHandler } from '../api/client';
import useIdleLogout from '../hooks/useIdleLogout';
import { IDLE_NOTICE_KEY, setTimerRunning } from '../utils/activity';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setTimerRunning(false);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  // Signed out after a period of inactivity (the length is a system setting).
  const handleIdle = useCallback(() => {
    try { sessionStorage.setItem(IDLE_NOTICE_KEY, '1'); } catch { /* storage unavailable */ }
    logout();
  }, [logout]);
  useIdleLogout({ active: !!user, timeoutMinutes: user?.sessionTimeoutMinutes, onTimeout: handleIdle });

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const { user: restoredUser } = await authApi.me();
        if (!cancelled) setUser(restoredUser);
      } catch {
        if (!cancelled) setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restoreSession();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (employeeId, password) => {
    const { token, user: loggedInUser } = await authApi.login(employeeId, password);
    setToken(token);
    setUser(loggedInUser);
    return loggedInUser;
  }, []);

  // What the signed-in person may do, as decided by the server.
  const can = useCallback((capability) => Boolean(user?.permissions?.includes(capability)), [user]);

  const value = { user, loading, login, logout, can, isAuthenticated: !!user };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
