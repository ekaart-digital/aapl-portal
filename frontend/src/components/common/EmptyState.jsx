import React from 'react';
import Icon from './IconMap';

export default function EmptyState({ title = 'Nothing here yet', sub = '', icon = 'Info', action = null }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={22} /></div>
      <div className="empty-title">{title}</div>
      {sub ? <div className="empty-sub">{sub}</div> : null}
      {action}
    </div>
  );
}
