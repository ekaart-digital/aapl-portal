import { apiFetch } from './client';

export function login(employeeId, password) {
  return apiFetch('/auth/login', { method: 'POST', body: { employeeId, password } });
}

export function me() {
  return apiFetch('/auth/me');
}

export function changePassword(currentPassword, newPassword) {
  return apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
}
