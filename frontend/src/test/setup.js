import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Newer Node versions ship an experimental global `localStorage` that has no
// storage behind it and hides jsdom's, so provide a plain in-memory one.
if (typeof globalThis.localStorage?.clear !== 'function') {
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
