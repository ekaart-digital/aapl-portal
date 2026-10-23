import React from 'react';

// segments: [{ label, value, color }]
export default function DonutChart({ segments, size = 160, thickness = 22, centerLabel, centerSub }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const frac = seg.value / total;
    const dash = frac * circumference;
    const arc = { ...seg, dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thickness} />
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {arcs.map((a, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={-a.offset}
              strokeLinecap="butt"
            />
          ))}
        </g>
        {centerLabel && (
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--ink)" fontFamily="var(--font-mono)">{centerLabel}</text>
        )}
        {centerSub && (
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">{centerSub}</text>
        )}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: seg.color, display: 'inline-block' }} />
            <span style={{ color: 'var(--ink-soft)' }}>{seg.label}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, marginLeft: 2 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
