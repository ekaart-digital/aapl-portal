import React from 'react';

// data: [{label, ...keys}]
// keys: [{key, color, name}]
export default function LineChart({ data, keys, height = 200 }) {
  const w = 640;
  const padL = 34, padB = 26, padT = 12, padR = 14;
  const chartW = w - padL - padR;
  const chartH = height - padT - padB;

  const maxVal = Math.max(...data.flatMap((d) => keys.map((k) => d[k.key] || 0)), 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 5;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));

  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0;

  function pointsFor(key) {
    return data.map((d, i) => {
      const x = padL + i * stepX;
      const y = padT + chartH - ((d[key] || 0) / niceMax) * chartH;
      return [x, y];
    });
  }

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img">
      {yTicks.map((t, i) => {
        const y = padT + chartH - (t / niceMax) * chartH;
        return (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={y + 3} fontSize="10" textAnchor="end" fill="var(--ink-faint)">{t}</text>
          </g>
        );
      })}
      {keys.map((k) => {
        const pts = pointsFor(k.key);
        const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
        return (
          <g key={k.key}>
            <path d={path} fill="none" stroke={k.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r="2.6" fill={k.color} />
            ))}
          </g>
        );
      })}
      {data.map((d, i) => (
        <text key={i} x={padL + i * stepX} y={height - 8} fontSize="10" textAnchor="middle" fill="var(--ink-faint)">{d.label}</text>
      ))}
    </svg>
  );
}
