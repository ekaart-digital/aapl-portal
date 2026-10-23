import { apiFetch } from './client';

export function listDepartments() {
  return apiFetch('/departments').then((r) => r.departments);
}

export function createDepartment(name) {
  return apiFetch('/departments', { method: 'POST', body: { name } }).then((r) => r.department);
}

export function updateDepartment(id, payload) {
  return apiFetch(`/departments/${id}`, { method: 'PATCH', body: payload });
}

export function deleteDepartment(id) {
  return apiFetch(`/departments/${id}`, { method: 'DELETE' });
}

export function createSubDepartment(departmentId, name) {
  return apiFetch(`/departments/${departmentId}/sub-departments`, { method: 'POST', body: { name } }).then((r) => r.subDepartment);
}

export function updateSubDepartment(id, name) {
  return apiFetch(`/sub-departments/${id}`, { method: 'PATCH', body: { name } });
}

export function deleteSubDepartment(id) {
  return apiFetch(`/sub-departments/${id}`, { method: 'DELETE' });
}
