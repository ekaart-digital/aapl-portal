import { apiFetch } from './client';

export function listFlaggedSessions() {
  return apiFetch('/time-logs/flagged');
}

export function adjustSession(logId, durationMinutes, note) {
  return apiFetch(`/time-logs/${logId}`, { method: 'PATCH', body: { durationMinutes, note } }).then((r) => r.timeLog);
}
