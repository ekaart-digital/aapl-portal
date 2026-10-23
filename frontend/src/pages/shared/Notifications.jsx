import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/layout/PageHeader';
import Tabs from '../../components/common/Tabs';
import Loading from '../../components/common/Loading';
import EmptyState from '../../components/common/EmptyState';
import NotificationItem from '../../components/notifications/NotificationItem';
import { useApp } from '../../context/AppContext';
import { useNotifications } from '../../context/NotificationsContext';
import * as notificationsApi from '../../api/notifications';

const PAGE_SIZE = 20;

export default function Notifications() {
  const { pushToast } = useApp();
  const navigate = useNavigate();
  const { setUnreadCount } = useNotifications();

  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await notificationsApi.listNotifications({ limit: PAGE_SIZE, unread: filter === 'unread' });
      setItems(data.notifications);
      setHasMore(data.hasMore);
      setUnreadCount(data.unreadCount);
      setFetchedAt(Date.now());
    } catch (err) {
      setError(err.message || 'Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [filter, setUnreadCount]);

  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const data = await notificationsApi.listNotifications({ limit: PAGE_SIZE, before: last.id, unread: filter === 'unread' });
      setItems((prev) => [...prev, ...data.notifications]);
      setHasMore(data.hasMore);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      pushToast(err.message || 'Failed to load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleOpen(n) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      notificationsApi.markRead(n.id).then(setUnreadCount).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  async function handleMarkAll() {
    try {
      await notificationsApi.markAllRead();
      setUnreadCount(0);
      setItems((prev) => (filter === 'unread' ? [] : prev.map((x) => ({ ...x, read: true }))));
      setHasMore(false);
      pushToast('All notifications marked as read.');
    } catch (err) {
      pushToast(err.message || 'Failed to mark notifications as read.');
    }
  }

  const hasUnread = items.some((n) => !n.read);

  return (
    <>
      <PageHeader
        title="Notifications"
        sub="Project and task updates"
        actions={<button className="btn" onClick={handleMarkAll} disabled={!hasUnread}>Mark all as read</button>}
      />
      <div className="card">
        <div className="card-pad">
          <Tabs
            items={[{ label: 'All', value: 'all' }, { label: 'Unread', value: 'unread' }]}
            active={filter}
            onChange={setFilter}
          />

          {loading ? (
            <Loading label="Loading notifications…" />
          ) : error ? (
            <EmptyState
              icon="AlertTriangle"
              title="Couldn't load notifications"
              sub={error}
              action={<button className="btn" style={{ marginTop: 12 }} onClick={load}>Retry</button>}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon="Bell"
              title={filter === 'unread' ? 'You’re all caught up' : 'No notifications yet'}
              sub={filter === 'unread' ? 'There is nothing unread.' : 'Updates about your projects and tasks will appear here.'}
            />
          ) : (
            <>
              <div data-testid="notification-list">
                {items.map((n) => (
                  <NotificationItem key={n.id} notification={n} fetchedAt={fetchedAt} onOpen={handleOpen} />
                ))}
              </div>
              {hasMore && (
                <div style={{ textAlign: 'center', marginTop: 14 }}>
                  <button className="btn" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
