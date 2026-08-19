'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { WeightUnit } from '@/lib/units';

const STORAGE_KEY = 'workout.weight-unit';

/**
 * The unit lives in `localStorage`, not in IndexedDB: it is a **device**
 * preference, not training data. Restoring a backup on a new phone should not
 * carry it over, and it has no business in the exported file.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab of the app may change it too.
  window.addEventListener('storage', onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getSnapshot(): WeightUnit {
  return window.localStorage.getItem(STORAGE_KEY) === 'lb' ? 'lb' : 'kg';
}

/**
 * Kilograms on the server: it is the canonical unit, so a hydration mismatch
 * would only be possible for someone who chose pounds — and the first client
 * render corrects it immediately.
 */
function getServerSnapshot(): WeightUnit {
  return 'kg';
}

/**
 * The display unit for loads.
 *
 * Read through `useSyncExternalStore` rather than an effect: `localStorage` is
 * external state, and this is what keeps every screen in step without a
 * provider or a `setState` inside an effect.
 */
export function useWeightUnit(): [WeightUnit, (unit: WeightUnit) => void] {
  const unit = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setUnit = useCallback((next: WeightUnit) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    for (const listener of listeners) listener();
  }, []);

  return [unit, setUnit];
}
