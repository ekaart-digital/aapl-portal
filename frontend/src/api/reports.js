import { apiFetch } from './client';

export function projectDetailsReport() {
  return apiFetch('/reports/projects').then((r) => r.projects);
}

export function employeeWorkTimeReport(params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v))
  ).toString();
  return apiFetch(`/reports/employee-work-time${qs ? `?${qs}` : ''}`).then((r) => r.employees);
}

export function monthlySummary(month) {
  return apiFetch(`/reports/monthly${month ? `?month=${month}` : ''}`);
}

// One person's work over a day, week or month. `date` is any day inside the period.
export function employeeReport(id, period = 'week', date) {
  return apiFetch(`/reports/employee/${id}?period=${period}${date ? `&date=${date}` : ''}`);
}

export function summaryReport(period = 'day', date) {
  return apiFetch(`/reports/summary?period=${period}${date ? `&date=${date}` : ''}`);
}
