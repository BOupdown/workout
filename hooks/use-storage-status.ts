'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export interface StorageStatus {
  /** The Storage API is available in this browser. `null` until mounted. */
  supported: boolean | null;
  /** `null` until the answer is known. */
  persisted: boolean | null;
  usageBytes: number | null;
  /** Asks explicitly, from the settings screen. */
  requestPersist: () => Promise<void>;
  /**
   * Asks on the app's own initiative, at most once per launch and never once
   * granted. Safe to call from anywhere data has just been created.
   */
  ensurePersisted: () => Promise<void>;
}

const supportsStorageApi = () => typeof navigator.storage?.persisted === 'function';

/** Support never changes during a session: there is nothing to subscribe to. */
const neverChanges = () => () => {};

/**
 * One automatic attempt per launch, shared by every caller of the hook.
 *
 * Per launch rather than once ever, because the answer is not final: Chrome
 * grants persistence on engagement — how often the site is opened, whether it
 * was installed — so a refusal today can become a grant next week without
 * anything changing in the app. Asking again on each launch costs nothing and
 * eventually succeeds. Where the browser prompts instead of deciding (Firefox),
 * a refusal is remembered by the browser itself, so this does not turn into a
 * dialog at every start.
 */
let askedThisLaunch = false;

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
 *
 * The request is made **by the app**, not by the user: leaving it behind a
 * button in the settings meant it was never made at all, which is the same as
 * having no protection. The button stays for anyone who wants to force it.
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
    // Re-checked at call time rather than trusted from the cached snapshot:
    // this throws *inside an effect* if it is wrong, which takes the screen
    // down with it. Optional chaining costs nothing and the cost of being
    // wrong is the whole app.
    if (!supported || typeof navigator.storage?.persisted !== 'function') return;
    let cancelled = false;

    // Values are set inside promise callbacks, never synchronously in the
    // body of the effect.
    navigator.storage.persisted().then(
      (value) => {
        if (!cancelled) setPersisted(value);
      },
      () => {},
    );

    if (typeof navigator.storage?.estimate === 'function') {
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
    if (!supported || typeof navigator.storage?.persist !== 'function') return;

    await navigator.storage.persist();
    setReading((count) => count + 1);
  }, [supported]);

  /**
   * Asked the moment there is something to lose — a session started, a set
   * written — rather than on the first paint.
   *
   * Two reasons. A first-time visitor with an empty database has nothing worth
   * a permission prompt, and browsers that decide on engagement are far more
   * likely to say yes to a site being used than to one just opened.
   */
  const ensurePersisted = useCallback(async () => {
    if (askedThisLaunch) return;
    if (!supported || typeof navigator.storage?.persist !== 'function') return;

    // Already durable: asking again would be pointless work on every set.
    if (await navigator.storage?.persisted()) {
      askedThisLaunch = true;
      return;
    }

    askedThisLaunch = true;
    await navigator.storage.persist();
    setReading((count) => count + 1);
  }, [supported]);

  return { supported, persisted, usageBytes, requestPersist, ensurePersisted };
}
