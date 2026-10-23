import { apiFetch } from './client';

export function listEmployees() {
  return apiFetch('/employees').then((r) => r.employees);
}

export function getEmployee(id) {
  return apiFetch(`/employees/${id}`).then((r) => r.employee);
}

export function createEmployee(payload) {
  return apiFetch('/employees', { method: 'POST', body: payload }).then((r) => r.employee);
}

export function updateEmployee(id, payload) {
  return apiFetch(`/employees/${id}`, { method: 'PATCH', body: payload }).then((r) => r.employee);
}

export function resetPassword(id, password) {
  return apiFetch(`/employees/${id}/password`, { method: 'PATCH', body: { password } });
}

// The photograph is fetched on its own (it is kept out of the lists).
export function getPhoto(id) {
  return apiFetch(`/employees/${id}/photo`).then((r) => r.photo);
}

export function setPhoto(id, photo) {
  return apiFetch(`/employees/${id}/photo`, { method: 'PUT', body: { photo } });
}
