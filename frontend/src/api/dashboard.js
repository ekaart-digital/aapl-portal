import { apiFetch } from './client';

// The home dashboard of a Team Leader, Department Head or Management user.
export function getOverview() {
  return apiFetch('/dashboard');
}

// Man-hour health of every project the user can see.
export function listProjectHealth() {
  return apiFetch('/dashboard/projects').then((r) => r.projects);
}

export function getProjectManHours(projectId) {
  return apiFetch(`/dashboard/projects/${projectId}`).then((r) => r.project);
}

export function listExceptions(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  return apiFetch(`/dashboard/exceptions${qs ? `?${qs}` : ''}`).then((r) => r.exceptions);
}
