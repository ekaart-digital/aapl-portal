import { apiFetch } from './client';

export function listTeams() {
  return apiFetch('/teams').then((r) => r.teams);
}

export function createTeam(payload) {
  return apiFetch('/teams', { method: 'POST', body: payload }).then((r) => r.team);
}

export function updateTeam(id, payload) {
  return apiFetch(`/teams/${id}`, { method: 'PATCH', body: payload }).then((r) => r.team);
}

export function deleteTeam(id) {
  return apiFetch(`/teams/${id}`, { method: 'DELETE' });
}
