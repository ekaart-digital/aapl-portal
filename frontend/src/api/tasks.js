import { apiFetch } from './client';

export function listMyTasks() {
  return apiFetch('/tasks/mine').then((r) => r.tasks);
}

export function getMyOpenSession() {
  // { openSession, autoStoppedSession, maxSessionMinutes }
  return apiFetch('/tasks/my-open-session');
}

export function getTask(id) {
  return apiFetch(`/tasks/${id}`).then((r) => r.task);
}

export function updateTask(id, payload) {
  return apiFetch(`/tasks/${id}`, { method: 'PATCH', body: payload }).then((r) => r.task);
}

export function listTaskTimeLogs(id) {
  return apiFetch(`/tasks/${id}/time-logs`).then((r) => r.timeLogs);
}

export function startTimer(taskId) {
  return apiFetch(`/tasks/${taskId}/time-logs/start`, { method: 'POST' }).then((r) => r.timeLog);
}

export function stopTimer(taskId, logId) {
  return apiFetch(`/tasks/${taskId}/time-logs/${logId}/stop`, { method: 'POST' }).then((r) => r.timeLog);
}

// The task categories from the requirements document (Calculation, Modelling, ...).
export function listCategories() {
  return apiFetch('/tasks/categories').then((r) => r.categories);
}
