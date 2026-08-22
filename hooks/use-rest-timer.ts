'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  clampRestDuration,
  DEFAULT_REST_SEC,
  extendRest,
  isRestStale,
  parseRestTimer,
  restProgress,
  type RestProgress,
  type RestTimer,
} from '@/lib/rest-timer';

/**
 * Both keys live in `localStorage` rather than IndexedDB, for the reason the
 * weight unit does: this is **device** state, not training data. A rest running
 * on the phone has no business in an exported backup, and no meaning once
 * restored on another device.
 */
const TIMER_KEY = 'workout.rest-timer';
const DURATION_KEY = 'workout.rest-duration';

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Two tabs of the app open on the same session.
  window.addEventListener('storage', onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * `useSyncExternalStore` compares snapshots by identity, so parsing on every
 * read would loop forever. The parsed timer is therefore kept alongside the raw
 * string it came from, and rebuilt only when that string changes.
 */
let cachedRaw: string | null = null;
let cachedTimer: RestTimer | null = null;

function getTimerSnapshot(): RestTimer | null {
  const raw = window.localStorage.getItem(TIMER_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTimer = parseRestTimer(raw);
  }
  return cachedTimer;
}

function getDurationSnapshot(): number {
  const raw = window.localStorage.getItem(DURATION_KEY);
  return raw === null ? DEFAULT_REST_SEC : clampRestDuration(Number(raw));
}

/**
 * No rest is running during the server render, and the default duration is the
 * same on both sides: the first client render agrees with the HTML, and only
 * then does the stored state take over.
 */
const noTimer = () => null;
const defaultDuration = () => DEFAULT_REST_SEC;

function writeTimer(timer: RestTimer | null): void {
  if (timer) window.localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  else window.localStorage.removeItem(TIMER_KEY);
  notify();
}

export interface RestTimerController {
  /** The rest in progress, or `null`. */
  timer: RestTimer | null;
  /** The duration a new rest gets, in seconds. */
  durationSec: number;
  setDurationSec: (seconds: number) => void;
  /** Starts a rest now, at the preferred duration unless one is given. */
  start: (seconds?: number) => void;
  /** Adds (or removes) time from the running rest. */
  extend: (deltaSec: number) => void;
  dismiss: () => void;
}

/**
 * The rest between two sets.
 *
 * Whether one is running, and how to start or stop it — but *not* where it
 * stands. That second number changes every second, and the two screens holding
 * this controller (the session, the settings) both re-rendered on every one of
 * those ticks while none of their content moved. The countdown therefore lives
 * in `useRestProgress`, called by the one component that draws it, so a rest
 * repaints a bar rather than an app.
 */
export function useRestTimer(): RestTimerController {
  const timer = useSyncExternalStore(subscribe, getTimerSnapshot, noTimer);
  const durationSec = useSyncExternalStore(subscribe, getDurationSnapshot, defaultDuration);

  const setDurationSec = useCallback((seconds: number) => {
    window.localStorage.setItem(DURATION_KEY, String(clampRestDuration(seconds)));
    notify();
  }, []);

  const start = useCallback(
    (seconds?: number) => {
      writeTimer({
        startedAt: Date.now(),
        durationSec: clampRestDuration(seconds ?? durationSec),
      });
    },
    [durationSec],
  );

  const extend = useCallback((deltaSec: number) => {
    const current = getTimerSnapshot();
    if (current) writeTimer(extendRest(current, deltaSec, Date.now()));
  }, []);

  const dismiss = useCallback(() => writeTimer(null), []);

  return { timer, durationSec, setDurationSec, start, extend, dismiss };
}

/**
 * Where a running rest stands, repainted once a second.
 *
 * The stored value is the *start*, never the remaining time, so a locked screen
 * or a throttled tab costs nothing: the countdown is recomputed from the clock
 * on every repaint. The interval only decides how often that repaint happens.
 *
 * `null` for a rest so far past its end that it is stale — left running on a
 * bench, or reopened the next day. It is dropped rather than hidden, storage
 * key and all, and the caller draws nothing in the meantime.
 */
export function useRestProgress(timer: RestTimer): RestProgress | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => {
      const instant = Date.now();
      if (isRestStale(timer, instant)) {
        writeTimer(null);
        return;
      }
      setNow(instant);
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  return isRestStale(timer, now) ? null : restProgress(timer, now);
}
