import { describe, expect, it } from 'vitest';
import {
  clampRestDuration,
  restDurationFromParts,
  splitRestDuration,
  DEFAULT_REST_SEC,
  extendRest,
  isRestStale,
  MAX_REST_SEC,
  MIN_REST_SEC,
  parseRestTimer,
  restProgress,
  STALE_AFTER_MS,
  type RestTimer,
} from '../lib/rest-timer';

const START = 1_700_000_000_000;
const timer = (durationSec = 90, startedAt = START): RestTimer => ({ startedAt, durationSec });

describe('restProgress', () => {
  it('counts down from the full duration', () => {
    const progress = restProgress(timer(90), START);
    expect(progress.phase).toBe('running');
    expect(progress.remainingSec).toBe(90);
    expect(progress.fraction).toBe(0);
  });

  it('holds the last second on screen for the whole of it', () => {
    // At 89.5 s gone there is half a second left: the counter must still show
    // 1, not 0, or it announces the end before it arrives.
    expect(restProgress(timer(90), START + 89_500).remainingSec).toBe(1);
  });

  it('tips to zero exactly at the end', () => {
    const progress = restProgress(timer(90), START + 90_000);
    expect(progress.phase).toBe('over');
    expect(progress.remainingSec).toBe(0);
    expect(progress.fraction).toBe(1);
  });

  it('counts the overrun once the rest has run out', () => {
    const progress = restProgress(timer(90), START + 100_000);
    expect(progress.phase).toBe('over');
    expect(progress.overdueSec).toBe(10);
  });

  it('never goes past 1 as a fraction', () => {
    expect(restProgress(timer(90), START + 500_000).fraction).toBe(1);
  });

  it('treats an instant before the start as the start', () => {
    // System clock set back mid-rest: a whole rest reads better than a
    // negative countdown.
    const progress = restProgress(timer(90), START - 5_000);
    expect(progress.remainingSec).toBe(90);
    expect(progress.fraction).toBe(0);
  });

  it('survives a locked screen, since everything comes from the clock', () => {
    // Not a single tick for 60 s: the result is the same as if the app had
    // stayed in the foreground.
    expect(restProgress(timer(90), START + 60_000).remainingSec).toBe(30);
  });
});

describe('isRestStale', () => {
  it('does not expire a rest that has only just ended', () => {
    expect(isRestStale(timer(90), START + 90_000 + 1_000)).toBe(false);
  });

  it('expires a rest forgotten long ago', () => {
    expect(isRestStale(timer(90), START + 90_000 + STALE_AFTER_MS + 1)).toBe(true);
  });
});

describe('extendRest', () => {
  it('on a running rest, adds to the duration without moving the start', () => {
    const extended = extendRest(timer(90), 30, START + 30_000);
    expect(extended.durationSec).toBe(120);
    expect(extended.startedAt).toBe(START);
    // 60 s were left, 90 are left now.
    expect(restProgress(extended, START + 30_000).remainingSec).toBe(90);
  });

  it('on a rest already over, restarts from now', () => {
    // The case that made the button useless: adding to the duration of a rest
    // 41 s past its end only shrank the overrun counter, and handed back not
    // one second of rest.
    const now = START + 131_000;
    const extended = extendRest(timer(90), 30, now);

    expect(extended.startedAt).toBe(now);
    expect(extended.durationSec).toBe(30);

    const progress = restProgress(extended, now);
    expect(progress.phase).toBe('running');
    expect(progress.remainingSec).toBe(30);
  });

  it('restarts a rest that has only just ended too', () => {
    const now = START + 90_000;
    expect(restProgress(extendRest(timer(90), 30, now), now).remainingSec).toBe(30);
  });

  it('does not go below the floor', () => {
    expect(extendRest(timer(90), -1_000, START).durationSec).toBe(MIN_REST_SEC);
  });
});

describe('clampRestDuration', () => {
  it('bounds it at both ends', () => {
    expect(clampRestDuration(0)).toBe(MIN_REST_SEC);
    expect(clampRestDuration(99_999)).toBe(MAX_REST_SEC);
  });

  it('falls back to the default for an invalid number', () => {
    expect(clampRestDuration(Number.NaN)).toBe(DEFAULT_REST_SEC);
  });

  it('rounds to the second', () => {
    expect(clampRestDuration(90.6)).toBe(91);
  });
});

describe('parseRestTimer', () => {
  it('reads back what was written', () => {
    expect(parseRestTimer(JSON.stringify(timer(120)))).toEqual(timer(120));
  });

  it('returns null for a missing key', () => {
    expect(parseRestTimer(null)).toBeNull();
  });

  it('returns null on broken JSON rather than throwing', () => {
    // Written by another version, or truncated: the session screen must not go
    // down over a timer.
    expect(parseRestTimer('{oops')).toBeNull();
    expect(parseRestTimer('"a string"')).toBeNull();
    expect(parseRestTimer('{"startedAt":"hier","durationSec":90}')).toBeNull();
  });

  it('bounds a stored duration that makes no sense', () => {
    expect(parseRestTimer('{"startedAt":1,"durationSec":999999}')?.durationSec).toBe(MAX_REST_SEC);
  });
});

describe('splitRestDuration', () => {
  it('splits a duration into the two fields', () => {
    expect(splitRestDuration(150)).toEqual({ minutes: '2', seconds: '30' });
  });

  it('pads the seconds, since the two fields read as one duration', () => {
    // "1" and "5" would say one minute five, and this field never means five.
    expect(splitRestDuration(65)).toEqual({ minutes: '1', seconds: '05' });
  });

  it('shows a duration under the minute as zero minutes', () => {
    expect(splitRestDuration(45)).toEqual({ minutes: '0', seconds: '45' });
  });

  it('shows what was actually kept, bounds included', () => {
    expect(splitRestDuration(99_999)).toEqual({ minutes: '60', seconds: '00' });
  });
});

describe('restDurationFromParts', () => {
  it('reads the two fields as one duration', () => {
    expect(restDurationFromParts({ minutes: '2', seconds: '30' })).toBe(150);
  });

  it('treats an empty field as zero', () => {
    expect(restDurationFromParts({ minutes: '2', seconds: '' })).toBe(120);
    expect(restDurationFromParts({ minutes: '', seconds: '45' })).toBe(45);
  });

  it('does not cap the seconds at 59', () => {
    // Someone after two and a half minutes may well type 150 into the box
    // already under their thumb.
    expect(restDurationFromParts({ minutes: '', seconds: '150' })).toBe(150);
  });

  it('waits rather than commits while the fields are empty', () => {
    expect(restDurationFromParts({ minutes: '', seconds: '' })).toBeNull();
  });

  it('reads a cleared field as an edit in progress, not a rest of zero', () => {
    expect(restDurationFromParts({ minutes: '0', seconds: '0' })).toBeNull();
  });

  it('refuses anything that is not whole digits', () => {
    expect(restDurationFromParts({ minutes: '1.5', seconds: '' })).toBeNull();
    expect(restDurationFromParts({ minutes: '', seconds: '30s' })).toBeNull();
    expect(restDurationFromParts({ minutes: '-2', seconds: '' })).toBeNull();
  });

  it('bounds an entry at both ends', () => {
    expect(restDurationFromParts({ minutes: '', seconds: '2' })).toBe(MIN_REST_SEC);
    expect(restDurationFromParts({ minutes: '90', seconds: '' })).toBe(MAX_REST_SEC);
  });
});
