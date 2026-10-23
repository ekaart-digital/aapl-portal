import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Icon from '../common/IconMap';
import Avatar from '../common/Avatar';
import NotificationItem from '../notifications/NotificationItem';
import { useNotifications } from '../../context/NotificationsContext';
import * as notificationsApi from '../../api/notifications';
import Modal from '../common/Modal';
import FormField from '../common/FormField';
import { useApp } from '../../context/AppContext';
import * as authApi from '../../api/auth';

const TITLES = {
  '/projects': ['Work', 'Projects'],
  '/employees': ['People', 'Employees'],
  '/structure': ['People', 'Organisation'],
  '/my-tasks': ['My Work', 'My Tasks'],
  '/my-progress': ['My Work', 'My Progress'],
  '/team': ['Overview', 'Team Dashboard'],
  '/department': ['Overview', 'Department Dashboard'],
  '/dashboard': ['Overview', 'Company Dashboard'],
  '/man-hours': ['Insights', 'Man-Hours'],
  '/exceptions': ['Insights', 'Exceptions'],
  '/reports': ['Insights', 'Reports'],
  '/summary': ['Insights', 'Summary'],
  '/work-report': ['Insights', 'Work Report'],
  '/my-report': ['My Work', 'My Report'],
  '/approvals': ['Insights', 'Approvals'],
  '/audit': ['Insights', 'Audit Trail'],
  '/admin': ['Overview', 'Administration'],
  '/my-time': ['My Work', 'My Time'],
  '/notifications': ['Insights', 'Notifications'],
};

export default function Header({ onMenuClick }) {
  const { user, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { pushToast } = useApp();
  const { unreadCount, setUnreadCount } = useNotifications();
  const [recent, setRecent] = useState([]);
  const [recentState, setRecentState] = useState('idle');
  const [recentFetchedAt, setRecentFetchedAt] = useState(Date.now());
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const base = '/' + location.pathname.split('/')[1];
  const [crumb, title] = TITLES[location.pathname] || TITLES[base] || ['AAPL Platform', 'Overview'];


  async function toggleNotifPanel() {
    const opening = !notifOpen;
    setNotifOpen(opening);
    setUserMenuOpen(false);
    if (!opening) return;

    setRecentState('loading');
    try {
      const data = await notificationsApi.listNotifications({ limit: 6 });
      setRecent(data.notifications);
      setUnreadCount(data.unreadCount);
      setRecentFetchedAt(Date.now());
      setRecentState('ready');
    } catch {
      setRecentState('error');
    }
  }

  function openNotification(n) {
    setNotifOpen(false);
    if (!n.read) {
      setRecent((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      notificationsApi.markRead(n.id).then(setUnreadCount).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  async function markAllFromPanel() {
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setRecent((prev) => prev.map((x) => ({ ...x, read: true })));
    } catch (err) {
      pushToast(err.message || 'Failed to mark notifications as read.');
    }
  }

  function closePw() {
    setPwOpen(false);
    setPwForm({ current: '', next: '', confirm: '' });
  }

  async function handleChangePassword() {
    if (!pwForm.current || !pwForm.next) {
      pushToast('Enter your current and new password.');
      return;
    }
    if (pwForm.next.length < 8) {
      pushToast('New password must be at least 8 characters.');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      pushToast('New password and confirmation do not match.');
      return;
    }
    setPwSaving(true);
    try {
      await authApi.changePassword(pwForm.current, pwForm.next);
      closePw();
      pushToast('Password changed.');
    } catch (err) {
      pushToast(err.message || 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  }

  function handleLogout() {
    setUserMenuOpen(false);
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="app-header">
      <div className="header-left">
        {onMenuClick && (
          <button className="icon-btn menu-btn" onClick={onMenuClick} aria-label="Open menu">
            <Icon name="Menu" size={16} />
          </button>
        )}
        <div>
          <div className="header-crumb">{crumb}</div>
          <div className="header-title">{title}</div>
        </div>
      </div>
      <div className="header-right">
        <div style={{ position: 'relative' }}>
          <button
            className="icon-btn"
            onClick={toggleNotifPanel}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          >
            <Icon name="Bell" size={16} />
            {unreadCount > 0 && <span className="count-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
          {notifOpen && (
            <div className="notif-panel" role="dialog" aria-label="Notifications">
              <div className="notif-head">
                <span>Notifications</span>
                <span style={{ display: 'flex', gap: 12 }}>
                  {unreadCount > 0 && <span className="link-btn" onClick={markAllFromPanel}>Mark all read</span>}
                  <span className="link-btn" onClick={() => { setNotifOpen(false); navigate('/notifications'); }}>View all</span>
                </span>
              </div>
              <div className="notif-list">
                {recentState === 'loading' && <div className="muted" style={{ padding: 16, fontSize: 12.5 }}>Loading…</div>}
                {recentState === 'error' && <div className="muted" style={{ padding: 16, fontSize: 12.5 }}>Couldn't load notifications.</div>}
                {recentState === 'ready' && recent.length === 0 && (
                  <div className="muted" style={{ padding: 16, fontSize: 12.5 }}>No notifications yet.</div>
                )}
                {recentState === 'ready' && recent.map((n) => (
                  <NotificationItem key={n.id} notification={n} fetchedAt={recentFetchedAt} onOpen={openNotification} className="compact" />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="role-switcher">
          <button className="role-switcher-btn" onClick={() => { setUserMenuOpen((v) => !v); setNotifOpen(false); }}>
            <Avatar name={user.name} />
            <span className="user-name">{user.name}</span>
            <Icon name="ChevronDown" size={13} />
          </button>
          {userMenuOpen && (
            <div className="role-menu">
              <div className="role-menu-item" style={{ cursor: 'default' }}>
                <div>{user.designation || user.roleLabel}</div>
                <div className="role-item-desc">{user.roleLabel}</div>
                <div className="role-item-desc">{user.email}</div>
              </div>
              <div className="role-menu-item" onClick={() => { setUserMenuOpen(false); setPwOpen(true); }}>
                Change password
              </div>
              <div className="role-menu-item" onClick={() => { setUserMenuOpen(false); navigate('/privacy'); }}>
                Privacy and data use
              </div>
              <div className="role-menu-item" onClick={handleLogout}>
                Log out
              </div>
            </div>
          )}
        </div>
      </div>
      {createPortal(<Modal
        open={pwOpen}
        onClose={closePw}
        title="Change password"
        footer={<>
          <button className="btn" onClick={closePw}>Cancel</button>
          <button className="btn btn-primary" onClick={handleChangePassword} disabled={pwSaving}>{pwSaving ? 'Saving…' : 'Change password'}</button>
        </>}
      >
        <FormField label="Current password">
          <input type="password" className="filter-input" style={{ width: '100%' }} value={pwForm.current} onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })} autoComplete="current-password" />
        </FormField>
        <FormField label="New password (min 8 characters)">
          <input type="password" className="filter-input" style={{ width: '100%' }} value={pwForm.next} onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })} autoComplete="new-password" />
        </FormField>
        <FormField label="Confirm new password">
          <input type="password" className="filter-input" style={{ width: '100%' }} value={pwForm.confirm} onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })} autoComplete="new-password" />
        </FormField>
      </Modal>, document.body)}
    </header>
  );
}
