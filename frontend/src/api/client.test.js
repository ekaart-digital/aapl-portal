import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError, setToken, getToken, setUnauthorizedHandler } from './client';

function mockFetch(status, body, { text } = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status text',
    text: async () => (text !== undefined ? text : JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('apiFetch', () => {
  beforeEach(() => setUnauthorizedHandler(null));
  afterEach(() => vi.unstubAllGlobals());

  it('sends the stored token as a Bearer header and JSON-encodes the body', async () => {
    setToken('abc123');
    const fetchMock = mockFetch(200, { ok: true });

    await apiFetch('/tasks/1', { method: 'PATCH', body: { status: 'On Hold' } });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/tasks\/1$/);
    expect(options.method).toBe('PATCH');
    expect(options.headers.Authorization).toBe('Bearer abc123');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.body).toBe(JSON.stringify({ status: 'On Hold' }));
  });

  it('sends no Authorization header when signed out', async () => {
    const fetchMock = mockFetch(200, {});
    await apiFetch('/departments');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('returns parsed JSON on success', async () => {
    mockFetch(200, { projects: [1, 2] });
    await expect(apiFetch('/projects')).resolves.toEqual({ projects: [1, 2] });
  });

  it('throws an ApiError carrying the server message and status', async () => {
    mockFetch(409, { error: { message: 'Stop the running timer first.' } });
    const err = await apiFetch('/x', { method: 'POST' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('Stop the running timer first.');
  });

  it('calls the unauthorized handler on a 401', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(401, { error: { message: 'Invalid or expired token' } });
    await expect(apiFetch('/auth/me')).rejects.toThrow('Invalid or expired token');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not call the unauthorized handler on other errors', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockFetch(403, { error: { message: 'Forbidden' } });
    await expect(apiFetch('/employees')).rejects.toThrow('Forbidden');
    expect(handler).not.toHaveBeenCalled();
  });

  it('turns a network failure into a readable error with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await apiFetch('/projects').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/could not reach the server/i);
  });

  it('survives a non-JSON error body', async () => {
    mockFetch(500, null, { text: '<html>Bad gateway</html>' });
    const err = await apiFetch('/projects').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  it('stores and clears the token', () => {
    setToken('t');
    expect(getToken()).toBe('t');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});
