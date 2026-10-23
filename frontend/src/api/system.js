import { apiFetch } from './client';

export function listSettings() {
  return apiFetch('/system/settings').then((r) => r.settings);
}

export function saveSettings(values) {
  return apiFetch('/system/settings', { method: 'PATCH', body: values });
}

export function getHealth() {
  return apiFetch('/system/health');
}
