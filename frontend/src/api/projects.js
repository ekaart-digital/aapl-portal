import { apiFetch } from './client';

export function listProjects() {
  return apiFetch('/projects').then((r) => r.projects);
}

export function getProject(id) {
  return apiFetch(`/projects/${id}`).then((r) => r.project);
}

export function createProject(payload) {
  return apiFetch('/projects', { method: 'POST', body: payload }).then((r) => r.project);
}

export function updateProject(id, payload) {
  return apiFetch(`/projects/${id}`, { method: 'PATCH', body: payload }).then((r) => r.project);
}

export function listProjectTasks(projectId) {
  return apiFetch(`/projects/${projectId}/tasks`).then((r) => r.tasks);
}

export function assignTask(projectId, payload) {
  return apiFetch(`/projects/${projectId}/tasks`, { method: 'POST', body: payload }).then((r) => r.task);
}

export function listAssignees(projectId) {
  return apiFetch(`/projects/${projectId}/assignees`).then((r) => r.assignees);
}

export function listProjectManagers() {
  return apiFetch('/projects/project-managers').then((r) => r.managers);
}

export function listTeamLeaders() {
  return apiFetch('/projects/team-leaders').then((r) => r.teamLeaders);
}
