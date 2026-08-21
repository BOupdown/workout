/**
 * Setup for the tests that render a screen.
 *
 * The in-memory IndexedDB comes first, for the same reason as in `./setup`:
 * Dexie probes the engine's capabilities when it loads.
 */
import 'fake-indexeddb/auto';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

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
