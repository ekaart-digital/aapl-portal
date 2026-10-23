import React from 'react';
import Icon from './IconMap';

export default function Drawer({ open, onClose, title, subtitle, children, footer }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
            {subtitle ? <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{subtitle}</div> : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
