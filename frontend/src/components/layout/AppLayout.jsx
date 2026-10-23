import React, { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ToastStack from '../common/ToastStack';
import { NotificationsProvider } from '../../context/NotificationsContext';

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => { setMenuOpen(false); }, [location.pathname]);

  return (
    <NotificationsProvider>
    <div className="app-shell">
      <Sidebar open={menuOpen} />
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="app-main">
        <Header onMenuClick={() => setMenuOpen((v) => !v)} />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
      <ToastStack />
    </div>
    </NotificationsProvider>
  );
}
