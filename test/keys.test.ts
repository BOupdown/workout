import { describe, expect, it } from 'vitest';
import { isLocalDate, localMidnight, newId, toLocalDate, toNameKey } from '../lib/db/keys';

describe('toNameKey', () => {
  it('strips accents and lowercases', () => {
    expect(toNameKey('Bench press')).toBe('bench press');
  });

  it('brings the variants of one movement together', () => {
    expect(toNameKey('Bench-Press  ')).toBe(toNameKey('bench press'));
    expect(toNameKey('BENCH   PRESS')).toBe(toNameKey('bench press'));
  });

  it('neutralises punctuation and case', () => {
    expect(toNameKey('One-arm dumbbell row')).toBe('one arm dumbbell row');
    expect(toNameKey("Curl 'biceps' !")).toBe('curl biceps');
  });
});

describe('newId', () => {
  it('generates a v4 UUID', () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });
});

describe('local dates', () => {
  it('accepts a day that exists', () => {
    expect(isLocalDate('2026-08-16')).toBe(true);
  });

  it('rejects a day that does not', () => {
    // With no overflow check, `new Date(2026, 1, 30)` would slide to 2 March.
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('16/08/2026')).toBe(false);
    expect(isLocalDate(20260816)).toBe(false);
  });

  it('round-trips a timestamp through a local day', () => {
    const midnight = localMidnight('2026-08-16');
    expect(toLocalDate(midnight)).toBe('2026-08-16');
  });

  it('stays on the right day late in the evening', () => {
    // The classic trap of a date derived in UTC: 23:00 local tips into the
    // next day for every timezone east of Greenwich.
    const lateEvening = new Date(2026, 7, 16, 23, 45).getTime();
    expect(toLocalDate(lateEvening)).toBe('2026-08-16');
  });

  it('throws on an invalid date rather than yielding a silent NaN', () => {
    expect(() => localMidnight('2026-02-30')).toThrow(RangeError);
  });
});
