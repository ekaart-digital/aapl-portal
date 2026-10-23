import React from 'react';
import Icon from './IconMap';

export default function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
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
