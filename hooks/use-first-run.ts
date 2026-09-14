'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Re-explain storage once to people who saw the former local-only promise.
const STORAGE_KEY = 'workout.told-where-data-lives.cloud-v1';

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getSnapshot(): boolean {
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

/**
 * Told, on the server.
 *
 * The note is a client-only fact, and claiming "not yet told" on the server
 * would render it into the HTML for everyone — including the people who were
 * told months ago, who would watch it appear and vanish on every cold load.
 * Saying "told" renders nothing, and `useSyncExternalStore` shows it right
 * after hydration for whoever has not been.
 */
function getServerSnapshot(): boolean {
  return true;
}

export interface FirstRun {
  /** Whether the note still has to be shown. */
  pending: boolean;
  acknowledge: () => void;
}

/**
 * Whether this device has been told where its training is kept.
 *
 * In `localStorage` rather than the database: it is a fact about *this
 * browser*, not about the training. Restoring a backup on a new phone should
 * not silence a note that phone has never shown, and it has no business in the
 * exported file.
 *
 * One key, one value, never cleared by the app — dismissing is final. Somebody
 * who reads it once should not meet it again on their fourth session.
 */
export function useFirstRun(): FirstRun {
  const told = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const acknowledge = useCallback(() => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    for (const listener of listeners) listener();
  }, []);

  return { pending: !told, acknowledge };
}
