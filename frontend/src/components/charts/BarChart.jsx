import React from 'react';

// series: [{ label, values: { key: number, ... } }]
// keys: [{ key, color, name }]
export default function BarChart({ data, keys, height = 200, stacked = false }) {
  const w = 640;
  const padL = 34, padB = 26, padT = 10, padR = 10;
  const chartW = w - padL - padR;
  const chartH = height - padT - padB;

  const maxVal = stacked
    ? Math.max(...data.map((d) => keys.reduce((sum, k) => sum + (d[k.key] || 0), 0)), 1)
    : Math.max(...data.flatMap((d) => keys.map((k) => d[k.key] || 0)), 1);
  const niceMax = Math.ceil(maxVal / 5) * 5 || 5;

  const bandW = chartW / data.length;
  const groupPad = bandW * 0.18;
  const innerW = bandW - groupPad * 2;
  const barW = stacked ? innerW : innerW / keys.length;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));

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
      {data.map((d, i) => {
        const x0 = padL + i * bandW + groupPad;
        let stackY = padT + chartH;
        return (
          <g key={i}>
            {keys.map((k, ki) => {
              const val = d[k.key] || 0;
              const bh = (val / niceMax) * chartH;
              const x = stacked ? x0 : x0 + ki * barW;
              const y = stacked ? stackY - bh : padT + chartH - bh;
              if (stacked) stackY -= bh;
              return (
                <rect key={k.key} x={x} y={y} width={Math.max(barW - (stacked ? 0 : 3), 1)} height={Math.max(bh, 0)} fill={k.color} rx="2" />
              );
            })}
            <text x={x0 + innerW / 2} y={height - 8} fontSize="10" textAnchor="middle" fill="var(--ink-faint)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
