'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  clampBarWeight,
  DEFAULT_BAR,
  DEFAULT_PLATES,
  normalisePlates,
} from '@/lib/plates';
import type { WeightUnit } from '@/lib/units';

/**
 * The bar and the plates in front of you.
 *
 * In `localStorage`, alongside the display unit and the rest duration, and for
 * the same reason: this describes the **room**, not the training. Restoring a
 * backup in a different gym should not bring the old rack's plates along, and
 * none of it has any business in the exported file.
 *
 * Stored **per unit**, which is the part that is easy to get wrong. A 20 kg bar
 * is not a 20 lb bar, and a 45 lb plate converts to 20.41 kg — a disc that
 * exists nowhere. Switching the display unit therefore switches to a second,
 * independent setup rather than converting the first one into fiction.
 */

const barKey = (unit: WeightUnit) => `workout.bar.${unit}`;
const platesKey = (unit: WeightUnit) => `workout.plates.${unit}`;

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

function write(key: string, value: string): void {
  window.localStorage.setItem(key, value);
  for (const listener of listeners) listener();
}

/**
 * The raw string under a key, or `null`.
 *
 * A **string**, deliberately, not the parsed value: `useSyncExternalStore`
 * compares snapshots by identity, and a `getSnapshot` that parsed on every call
 * would hand back a new array each time and re-render forever. Parsing happens
 * in `useMemo` below, downstream of the comparison.
 */
function useStoredValue(key: string): string | null {
  const read = useCallback(() => window.localStorage.getItem(key), [key]);

  // Nothing stored on the server, so every default below applies — and the
  // first client render corrects it, exactly as the unit preference does.
  return useSyncExternalStore(subscribe, read, () => null);
}

export interface PlateSetup {
  /** The bar, in the display unit. */
  barWeight: number;
  setBarWeight: (weight: number) => void;
  /** Denominations on the rack, heaviest first. May legitimately be empty. */
  plates: number[];
  /** Adds the denomination, or takes it off when it is already there. */
  togglePlate: (weight: number) => void;
}

export function usePlateSetup(unit: WeightUnit): PlateSetup {
  const storedBar = useStoredValue(barKey(unit));
  const storedPlates = useStoredValue(platesKey(unit));

  const barWeight = useMemo(() => {
    if (storedBar === null) return DEFAULT_BAR[unit];

    const parsed = Number(storedBar);
    return Number.isFinite(parsed) ? clampBarWeight(parsed) : DEFAULT_BAR[unit];
  }, [storedBar, unit]);

  const plates = useMemo(() => {
    // An empty string is not a missing setting: it is a rack with nothing on
    // it, which is what turning every plate off means. Only `null` — the key
    // never written — falls back to the defaults.
    if (storedPlates === null) return [...DEFAULT_PLATES[unit]];

    return normalisePlates(storedPlates.split(',').map(Number), unit);
  }, [storedPlates, unit]);

  const setBarWeight = useCallback(
    (weight: number) => write(barKey(unit), String(clampBarWeight(weight))),
    [unit],
  );

  const togglePlate = useCallback(
    (weight: number) => {
      const next = plates.includes(weight)
        ? plates.filter((plate) => plate !== weight)
        : [...plates, weight];

      write(platesKey(unit), normalisePlates(next, unit).join(','));
    },
    [plates, unit],
  );

  return { barWeight, setBarWeight, plates, togglePlate };
}
