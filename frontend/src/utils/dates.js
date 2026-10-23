// Plain YYYY-MM-DD dates for the period reports. Everything is done on the
// calendar date in the browser's own time zone, never through UTC, so the day
// a person sees is the day that is sent.

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export const todayStr = () => fmt(new Date());

// Moves a date by one day, week or month (dir is 1 or -1). A month always lands on the 1st.
export function shiftDate(date, period, dir) {
  const d = parse(date);
  if (period === 'day') d.setDate(d.getDate() + dir);
  else if (period === 'week') d.setDate(d.getDate() + 7 * dir);
  else { d.setDate(1); d.setMonth(d.getMonth() + dir); }
  return fmt(d);
}

const LONG = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };

// "Mon 6 Oct 2026", "5 Oct – 11 Oct 2026" or "October 2026".
export function describePeriod(period, from, to) {
  const a = parse(from);
  if (period === 'day') return a.toLocaleDateString(undefined, LONG);
  if (period === 'month') return a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const b = parse(to);
  return `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// A short label for one day on a chart: the weekday and date for a week, just the date number for a month.
export function dayLabel(date, period) {
  const d = parse(date);
  return period === 'week' ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : String(d.getDate());
}
