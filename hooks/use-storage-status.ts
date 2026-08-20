'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export interface StorageStatus {
  /** The Storage API is available in this browser. `null` until mounted. */
  supported: boolean | null;
  /** `null` until the answer is known. */
  persisted: boolean | null;
  usageBytes: number | null;
  requestPersist: () => Promise<void>;
}

const supportsStorageApi = () => typeof navigator.storage?.persisted === 'function';

/** Support never changes during a session: there is nothing to subscribe to. */
const neverChanges = () => () => {};

/**
 * Durable storage state.
 *
 * `navigator.storage.persist()` asks the browser **not to evict** the data under
 * storage pressure. Without that request, IndexedDB is among the first things
 * cleared when the device runs short of space.
 *
 * Chrome answers on its own heuristics (app installed, site visited regularly),
 * Firefox asks the user. A refusal is not an error: it just has to be stated
 * honestly, with a backup offered instead.
 */
export function useStorageStatus(): StorageStatus {
  // `navigator` does not exist during the server render. Answering "not
  // supported" there would contradict the first client render, so the server
  // snapshot is `null` and the real answer only arrives once mounted.
  const supported = useSyncExternalStore(neverChanges, supportsStorageApi, () => null);

  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  // Bumped after a request, to re-read the state from the browser.
  const [reading, setReading] = useState(0);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    // Values are set inside promise callbacks, never synchronously in the
    // body of the effect.
    navigator.storage.persisted().then(
      (value) => {
        if (!cancelled) setPersisted(value);
      },
      () => {},
    );

    if (typeof navigator.storage.estimate === 'function') {
      navigator.storage.estimate().then(
        (estimate) => {
          if (!cancelled) setUsageBytes(estimate.usage ?? null);
        },
        () => {},
      );
    }

    return () => {
      cancelled = true;
    };
  }, [supported, reading]);

  const requestPersist = useCallback(async () => {
    if (!supported || typeof navigator.storage.persist !== 'function') return;

    await navigator.storage.persist();
    setReading((count) => count + 1);
  }, [supported]);

  return { supported, persisted, usageBytes, requestPersist };
}
