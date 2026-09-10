/**
 * Setup for the tests that render a screen.
 *
 * The in-memory IndexedDB comes first, for the same reason as in `./setup`:
 * Dexie probes the engine's capabilities when it loads.
 */
import 'fake-indexeddb/auto';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Node 26 exposes a disabled `localStorage` global unless it is given a file.
 * Vitest copies that value onto jsdom's window, replacing jsdom's own storage
 * with `undefined`. Tests exercise browser persistence heavily, so give every
 * screen worker an isolated in-memory implementation instead of making `npm
 * test` depend on a Node command-line flag.
 */
class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key: string) {
    return this.#values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#values.delete(key);
  }

  setItem(key: string, value: string) {
    this.#values.set(String(key), String(value));
  }
}

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

// Unmounting between tests. Without it a screen from the previous test stays in
// the document and every `getByRole` finds two of everything.
afterEach(cleanup);

/**
 * jsdom implements neither of these, and both are used on the session screen —
 * the tab track observes scrolling, the sheets do not scroll anything into
 * view. Absent, they throw and take the render down with them.
 */
Element.prototype.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
