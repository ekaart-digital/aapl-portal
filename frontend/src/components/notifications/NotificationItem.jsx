import React from 'react';
import StatusBadge from '../common/StatusBadge';
import { timeAgo } from '../../utils/timeAgo';

const SEVERITY = {
  critical: { color: 'red', label: 'Critical' },
  attention: { color: 'amber', label: 'Attention' },
  info: { color: 'grey', label: 'Info' },
};

export default function NotificationItem({ notification, fetchedAt, onOpen, className = '' }) {
  const n = notification;
  const sev = SEVERITY[n.severity] || SEVERITY.info;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`notif-row ${n.read ? '' : 'unread'} ${className}`}
      onClick={() => onOpen(n)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(n); } }}
    >
      <div className="notif-row-main">
        <div className="notif-row-top">
          <StatusBadge severity={sev.color} status="">{sev.label}</StatusBadge>
          {!n.read && <span className="notif-unread-dot" aria-label="Unread" />}
        </div>
        <div className="notif-row-title">{n.title}</div>
        <div className="muted notif-row-body">{n.body}</div>
      </div>
      <span className="notif-time">{timeAgo(n.ageSeconds, fetchedAt)}</span>
    </div>
  );
}
