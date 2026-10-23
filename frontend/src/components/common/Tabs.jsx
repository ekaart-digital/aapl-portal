import React from 'react';

export default function Tabs({ items, active, onChange }) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <div
          key={it.value}
          className={`tab-item ${active === it.value ? 'active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}
