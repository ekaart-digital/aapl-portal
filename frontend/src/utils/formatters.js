export function fmtHours(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function fmtNum(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

export function fmtCurrency(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function fmtPct(n) {
  return `${Math.round(n)}%`;
}

export function severityToBadgeClass(severity) {
  return { red: 'badge-red', amber: 'badge-amber', green: 'badge-green', grey: 'badge-grey', blue: 'badge-blue' }[severity] || 'badge-grey';
}

export function riskColor(risk) {
  return { red: 'var(--status-red)', amber: 'var(--status-amber)', green: 'var(--status-green)' }[risk] || 'var(--status-grey)';
}
