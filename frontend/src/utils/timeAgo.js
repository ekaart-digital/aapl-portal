// "3 minutes ago" from an age in seconds. `ageSeconds` was measured by the
// server when the data was fetched; `fetchedAt` (ms) lets the label keep
// advancing without re-fetching.
export function timeAgo(ageSeconds, fetchedAt = Date.now(), now = Date.now()) {
  const seconds = Math.max(0, Math.floor((Number(ageSeconds) || 0) + (now - fetchedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
