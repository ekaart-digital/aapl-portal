import { apiFetch } from './client';

// { notifications, hasMore, unreadCount }
export function listNotifications({ limit, before, unread } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', limit);
  if (before) params.set('before', before);
  if (unread) params.set('unread', '1');
  const qs = params.toString();
  return apiFetch(`/notifications${qs ? `?${qs}` : ''}`);
}

export function getUnreadCount() {
  return apiFetch('/notifications/unread-count').then((r) => r.unreadCount);
}

export function markRead(id) {
  return apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }).then((r) => r.unreadCount);
}

export function markAllRead() {
  return apiFetch('/notifications/read-all', { method: 'POST' }).then((r) => r.unreadCount);
}
