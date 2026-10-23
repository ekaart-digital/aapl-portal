import React from 'react';

export default function StatCard({ label, value, foot, accent, footTrend }) {
  const accentClass = accent ? `accent-${accent}` : '';
  const footClass = footTrend ? footTrend : '';
  return (
    <div className={`stat-card ${accentClass}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {foot ? <div className={`stat-foot ${footClass}`}>{foot}</div> : null}
    </div>
  );
}
