import { apiFetch } from './client';

// Finished sessions from the last few days, with the state of any request.
export function listMySessions() {
  return apiFetch('/corrections/sessions');
}

export function listMyRequests() {
  return apiFetch('/corrections/mine').then((r) => r.requests);
}

export function requestCorrection({ logId, durationMinutes, reason }) {
  return apiFetch('/corrections', { method: 'POST', body: { logId, durationMinutes, reason } }).then((r) => r.request);
}

// Requests from the people the user reviews. `status` is 'pending' (default) or 'all'.
export function listForReview(status = 'pending') {
  return apiFetch(`/corrections?status=${status}`).then((r) => r.requests);
}

export function approveRequest(id, note) {
  return apiFetch(`/corrections/${id}/approve`, { method: 'POST', body: { note } }).then((r) => r.request);
}

export function rejectRequest(id, note) {
  return apiFetch(`/corrections/${id}/reject`, { method: 'POST', body: { note } }).then((r) => r.request);
}
