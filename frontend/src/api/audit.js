import { apiFetch } from './client';

// filters: entityType, action, actorId, q, from, to, limit, offset
export function listAudit(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, v); });
  const qs = params.toString();
  return apiFetch(`/audit${qs ? `?${qs}` : ''}`);
}
