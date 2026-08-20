/**
 * The rest between two sets.
 *
 * Everything here derives from two numbers — when the rest started, how long it
 * was set to run — and never from a counter incremented on a tick. A phone
 * locks its screen, a browser throttles timers in a background tab, and a set
 * gets logged while the app is closed: only arithmetic on the clock survives
 * all three. The interval in the hook exists to repaint, not to count.
 */

import type { Timestamp } from './db/types';

/** The choices offered in the settings, in seconds. */
export const REST_DURATIONS_SEC = [60, 90, 120, 180] as const;

export const DEFAULT_REST_SEC = 90;

/** Bounds for a stored or extended duration, so a corrupt value cannot stick. */
export const MIN_REST_SEC = 5;
export const MAX_REST_SEC = 60 * 60;

/**
 * Past this much time after zero, a rest is no longer a rest: the app was left
 * open on a bench, or reopened the next day. Showing "over by 14 hours" would
 * be noise, so the bar drops it instead.
 */
export const STALE_AFTER_MS = 10 * 60_000;

/** A rest in progress. Absent means no rest is running. */
export interface RestTimer {
  startedAt: Timestamp;
  durationSec: number;
}

export type RestPhase = 'running' | 'over';

export interface RestProgress {
  phase: RestPhase;
  /** Seconds still to wait. Zero once the phase is `over`. */
  remainingSec: number;
  /** Seconds elapsed past zero. Zero while `running`. */
  overdueSec: number;
  /** Share of the rest already served, clamped to 0…1. */
  fraction: number;
}

/** Keeps a duration inside the bounds, rounded to a whole second. */
export function clampRestDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_REST_SEC;
  return Math.min(MAX_REST_SEC, Math.max(MIN_REST_SEC, Math.round(seconds)));
}

/**
 * Where a rest stands at a given instant.
 *
 * `now` is passed in rather than read here: that is what makes the whole
 * countdown testable without faking a clock, and what lets one render use a
 * single consistent instant.
 */
export function restProgress(timer: RestTimer, now: Timestamp): RestProgress {
  const totalMs = timer.durationSec * 1000;
  const elapsedMs = Math.max(0, now - timer.startedAt);
  const leftMs = totalMs - elapsedMs;

  return {
    phase: leftMs > 0 ? 'running' : 'over',
    // Ceil while running: a countdown must show "1" for the whole last second
    // and reach "0" exactly when the rest is served, never a beat early.
    remainingSec: leftMs > 0 ? Math.ceil(leftMs / 1000) : 0,
    overdueSec: leftMs > 0 ? 0 : Math.floor(-leftMs / 1000),
    fraction: totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 1,
  };
}

/** A rest so long past its end that it is stale rather than over. */
export function isRestStale(timer: RestTimer, now: Timestamp): boolean {
  return now - (timer.startedAt + timer.durationSec * 1000) > STALE_AFTER_MS;
}

/**
 * Adds time to a rest.
 *
 * Two cases, because "+30 s" means the same thing to the user in both and the
 * arithmetic does not:
 *
 * - Still running: the duration grows and the start stays put, so thirty
 *   seconds are added to what was left.
 * - Already over: growing the duration would only shrink the overdue counter —
 *   tapping "+30 s" on a rest over by a minute would hand back no rest at all.
 *   The rest therefore restarts from `now`, for the time asked.
 */
export function extendRest(timer: RestTimer, deltaSec: number, now: Timestamp): RestTimer {
  if (deltaSec <= 0) {
    return { ...timer, durationSec: clampRestDuration(timer.durationSec + deltaSec) };
  }

  if (restProgress(timer, now).phase === 'over') {
    return { startedAt: now, durationSec: clampRestDuration(deltaSec) };
  }

  return { ...timer, durationSec: clampRestDuration(timer.durationSec + deltaSec) };
}

/** Reads a timer back from storage, rejecting anything malformed. */
export function parseRestTimer(raw: string | null): RestTimer | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;

    const { startedAt, durationSec } = value as Partial<RestTimer>;
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
    if (typeof durationSec !== 'number' || !Number.isFinite(durationSec)) return null;

    return { startedAt, durationSec: clampRestDuration(durationSec) };
  } catch {
    // Written by a different version, or truncated: no reason to break the
    // session screen over a rest timer.
    return null;
  }
}
