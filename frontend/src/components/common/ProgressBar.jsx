import React from 'react';

export default function ProgressBar({ pct, color = 'accent' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="progress-track">
      <div className={`progress-fill ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
