// Day, week (Monday to Sunday) and month ranges for the period reports.
// Dates are plain YYYY-MM-DD strings and are never converted through a time
// zone, so "2026-03-31" is always the 31st.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = ['day', 'week', 'month'];

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Returns { period, from, to, days:[every date in the range] }, or { error }.
function periodRange(period = 'day', date = today()) {
  if (!PERIODS.includes(period)) return { error: `period must be one of: ${PERIODS.join(', ')}.` };
  if (!DATE_RE.test(date) || Number.isNaN(parse(date).getTime()) || fmt(parse(date)) !== date) {
    return { error: 'date must be a real date in YYYY-MM-DD format.' };
  }
  const d = parse(date);
  let start = d;
  let end = d;
  if (period === 'week') {
    const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
    start = addDays(d, -offset);
    end = addDays(start, 6);
  } else if (period === 'month') {
    start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  }
  const days = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) days.push(fmt(cur));
  return { period, from: fmt(start), to: fmt(end), days };
}

module.exports = { periodRange, PERIODS, today };
