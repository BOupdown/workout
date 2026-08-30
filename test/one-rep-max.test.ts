import { describe, expect, it } from 'vitest';
import { estimateOneRepMaxKg, MAX_ESTIMABLE_REPS, supportsOneRepMax } from '../lib/one-rep-max';

describe('estimateOneRepMaxKg', () => {
  it('returns the load itself for a single', () => {
    // The property that decided the formula: Brzycki is exact at one rep, where
    // Epley reports 103.3 for a 100 kg single and has to be special-cased.
    expect(estimateOneRepMaxKg(100, 1)).toBe(100);
    expect(estimateOneRepMaxKg(62.5, 1)).toBe(62.5);
  });

  it('scales with the reps', () => {
    expect(estimateOneRepMaxKg(100, 5)).toBe(112.5);
    expect(estimateOneRepMaxKg(100, 10)).toBe(133.3);
  });

  it('rounds to a tenth, since this is a model and not a measurement', () => {
    // 2430 / 29 = 83.7931…
    expect(estimateOneRepMaxKg(67.5, 8)).toBe(83.8);
  });

  it('estimates up to the ceiling and refuses past it', () => {
    expect(estimateOneRepMaxKg(100, MAX_ESTIMABLE_REPS)).toBe(144);
    expect(estimateOneRepMaxKg(100, MAX_ESTIMABLE_REPS + 1)).toBeNull();
    expect(estimateOneRepMaxKg(100, 20)).toBeNull();
  });

  it('has nothing to say about a set with no load', () => {
    // An external exercise logged at 0 is the empty bar: a real performance,
    // and no load for the formula to multiply.
    expect(estimateOneRepMaxKg(0, 5)).toBeNull();
    expect(estimateOneRepMaxKg(-10, 5)).toBeNull();
  });

  it('refuses zero reps and anything unreadable', () => {
    expect(estimateOneRepMaxKg(100, 0)).toBeNull();
    expect(estimateOneRepMaxKg(100, 2.5)).toBeNull();
    expect(estimateOneRepMaxKg(Number.NaN, 5)).toBeNull();
    expect(estimateOneRepMaxKg(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('ranks a heavier set above a longer one, and the reverse', () => {
    // The comparison the measured curve cannot make: ten at 60 is the stronger
    // showing, even though five at 65 is the heavier bar.
    expect(estimateOneRepMaxKg(60, 10)).toBe(80);
    expect(estimateOneRepMaxKg(65, 5)).toBe(73.1);

    // And it does not simply favour reps: five at 100 beats a single at 105.
    expect(estimateOneRepMaxKg(100, 5)).toBeGreaterThan(estimateOneRepMaxKg(105, 1) as number);
  });
});

describe('supportsOneRepMax', () => {
  it('accepts a barbell exercise counted in reps', () => {
    expect(supportsOneRepMax({ loadType: 'external', metric: 'reps' })).toBe(true);
  });

  it('refuses an exercise with no load to scale', () => {
    expect(supportsOneRepMax({ loadType: 'bodyweight', metric: 'reps' })).toBe(false);
  });

  it('refuses added load, which is only half of what was moved', () => {
    // A weighted pull-up moves bodyweight plus the belt, and the set records
    // the belt alone.
    expect(supportsOneRepMax({ loadType: 'weighted_bodyweight', metric: 'reps' })).toBe(false);
  });

  it('refuses assistance, where the formula would run backwards', () => {
    // More load means more help means weaker, so an estimate off it would
    // report progress for a set that needed more of it.
    expect(supportsOneRepMax({ loadType: 'assisted', metric: 'reps' })).toBe(false);
  });

  it('refuses a held position, which has no reps', () => {
    expect(supportsOneRepMax({ loadType: 'external', metric: 'time' })).toBe(false);
  });
});
