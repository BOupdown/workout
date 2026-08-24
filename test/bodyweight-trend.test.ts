import { describe, expect, it } from 'vitest';
import { buildWeightTrend } from '../lib/bodyweight-trend';
import type { BodyWeight } from '../lib/db/types';

const entry = (date: string, weightKg: number): BodyWeight =>
  ({ date, weightKg }) as BodyWeight;

describe('buildWeightTrend', () => {
  it('sorts the weigh-ins, whatever order they arrive in', () => {
    const trend = buildWeightTrend(
      [entry('2026-08-20', 80), entry('2026-08-01', 82)],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.points.map((point) => point.date)).toEqual(['2026-08-01', '2026-08-20']);
  });

  it('places the points by date, not by rank', () => {
    // The heart of it: weighing yourself on the 1st, 2nd and 3rd and then on
    // the 31st is not four evenly spaced facts. An indexed axis would draw a
    // steady slope across a four-week hole.
    const trend = buildWeightTrend(
      [
        entry('2026-08-01', 80),
        entry('2026-08-02', 80.2),
        entry('2026-08-03', 80.1),
        entry('2026-08-31', 78),
      ],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.fractions[0]).toBeCloseTo(0);
    expect(trend.fractions[1]).toBeCloseTo(1 / 30);
    expect(trend.fractions[2]).toBeCloseTo(2 / 30);
    expect(trend.fractions[3]).toBeCloseTo(1);
  });

  it('measures the span over the window, not over the weigh-ins', () => {
    // Two weigh-ins a week apart inside a month stay a week apart, close to
    // where they sit on the calendar above, instead of being stretched from
    // one edge to the other.
    const trend = buildWeightTrend(
      [entry('2026-08-10', 80), entry('2026-08-17', 79)],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.fractions[0]).toBeCloseTo(9 / 30);
    expect(trend.fractions[1]).toBeCloseTo(16 / 30);
  });

  it('returns the difference between the first and the last weigh-in', () => {
    const trend = buildWeightTrend(
      [entry('2026-08-01', 82), entry('2026-08-31', 79.5)],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.delta).toBeCloseTo(-2.5);
  });

  it('gives no difference from a single weigh-in', () => {
    // One measurement is not a trend.
    const trend = buildWeightTrend([entry('2026-08-10', 80)], '2026-08-01', '2026-08-31');

    expect(trend.points).toHaveLength(1);
    expect(trend.delta).toBeNull();
  });

  it('returns nothing for a window holding no weigh-in', () => {
    const trend = buildWeightTrend([], '2026-08-01', '2026-08-31');

    expect(trend.points).toEqual([]);
    expect(trend.fractions).toEqual([]);
    expect(trend.delta).toBeNull();
  });

  it('produces no NaN for a window one day wide', () => {
    // `to === from` gives a span of zero: an unguarded division would yield
    // NaN positions, and the SVG path would vanish with no error.
    const trend = buildWeightTrend([entry('2026-08-10', 80)], '2026-08-10', '2026-08-10');

    expect(Number.isFinite(trend.fractions[0])).toBe(true);
  });

  it('keeps the positions inside the window', () => {
    // A weigh-in out of bounds must not draw outside the frame.
    const trend = buildWeightTrend(
      [entry('2026-07-20', 81), entry('2026-09-05', 79)],
      '2026-08-01',
      '2026-08-31',
    );

    for (const fraction of trend.fractions) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});
