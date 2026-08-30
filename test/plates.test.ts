import { describe, expect, it } from 'vitest';
import {
  clampBarWeight,
  DEFAULT_PLATES,
  describePerSide,
  groupPlates,
  normalisePlates,
  solvePlates,
  type PlateResult,
} from '../lib/plates';

const KG = DEFAULT_PLATES.kg;

/** Narrows to the loaded case, so a test reads the fields without a guard. */
function loaded(result: PlateResult) {
  if (result.status !== 'loaded') throw new Error(`Expected a loading, got ${result.status}`);
  return result;
}

describe('solvePlates', () => {
  it('halves what is left once the bar is taken off', () => {
    // 100 on a 20 bar is 40 a side, and 40 is 25 + 15.
    expect(loaded(solvePlates(100, 20, KG)).perSide).toEqual([25, 15]);
  });

  it('reaches the quarter kilos without drifting', () => {
    // 36.25 a side. The whole reason the search runs on integers: computed in
    // floats this lands on 36.249999999999996 and reports "unreachable".
    const result = loaded(solvePlates(92.5, 20, KG));

    expect(result.perSide).toEqual([25, 10, 1.25]);
    expect(result.total).toBe(92.5);
    expect(result.shortfall).toBe(0);
  });

  it('finds a loading a greedy pass would declare impossible', () => {
    // The case the whole search exists for: 30 a side is 15 + 15, but taking
    // the heaviest plate that fits leaves 5 with nothing to build it from.
    const result = loaded(solvePlates(80, 20, [25, 20, 15]));

    expect(result.perSide).toEqual([15, 15]);
    expect(result.shortfall).toBe(0);
  });

  it('uses as few plates as it can', () => {
    // 40 a side is 25 + 15, not 20 + 10 + 10 and not 8 fives.
    expect(loaded(solvePlates(100, 20, KG)).perSide).toHaveLength(2);
  });

  it('settles a tie towards the heavier plate', () => {
    // 25 a side is 20 + 5 as readily as 15 + 10. The bigger disc goes on first,
    // which is both fewer things to pick up and how it is loaded.
    expect(loaded(solvePlates(70, 20, [20, 15, 10, 5])).perSide).toEqual([20, 5]);
  });

  it('says the bar is enough when the target is the bar', () => {
    const result = loaded(solvePlates(20, 20, KG));

    expect(result.perSide).toEqual([]);
    expect(result.total).toBe(20);
    expect(result.shortfall).toBe(0);
  });

  it('refuses a target lighter than the bar', () => {
    expect(solvePlates(15, 20, KG).status).toBe('below-bar');
  });

  it('has nothing to say before a load is typed', () => {
    expect(solvePlates(null, 20, KG).status).toBe('no-target');
  });

  it('turns a typo away rather than sizing an array to it', () => {
    expect(solvePlates(100_000, 20, KG).status).toBe('out-of-range');
  });

  describe('when the target cannot be built', () => {
    it('stops below it and names the gap', () => {
      // No 1.25s on this rack, so 36.25 a side is out of reach: 35 is the
      // closest, which is 90 on the bar.
      const result = loaded(solvePlates(92.5, 20, [25, 20, 15, 10, 5, 2.5]));

      expect(result.perSide).toEqual([25, 10]);
      expect(result.total).toBe(90);
      expect(result.shortfall).toBe(2.5);
    });

    it('counts the half a side cannot hold', () => {
      // 41.25 over two sleeves is 20.625 each, which no plate reaches. The
      // shortfall is measured against the target, so the odd quarter is in it.
      const result = loaded(solvePlates(61.25, 20, KG));

      expect(result.total).toBe(60);
      expect(result.shortfall).toBe(1.25);
    });

    it('never goes over, even by a plate', () => {
      const result = loaded(solvePlates(100, 20, [25]));

      expect(result.total).toBeLessThan(100);
      expect(result.perSide).toEqual([25]);
      expect(result.shortfall).toBe(30);
    });

    it('leaves the bar bare when no plate is turned on', () => {
      const result = loaded(solvePlates(100, 20, []));

      expect(result.perSide).toEqual([]);
      expect(result.total).toBe(20);
      expect(result.shortfall).toBe(80);
    });
  });

  it('works in pounds on pound plates', () => {
    // 225 on a 45 bar: two 45s a side. Nothing here is converted — these are
    // the numbers stamped on the discs.
    expect(loaded(solvePlates(225, 45, DEFAULT_PLATES.lb)).perSide).toEqual([45, 45]);
  });

  it('ignores a plate that weighs nothing', () => {
    expect(loaded(solvePlates(60, 20, [20, 0, -5])).perSide).toEqual([20]);
  });
});

describe('groupPlates', () => {
  it('counts the identical ones', () => {
    expect(groupPlates([25, 25, 10])).toEqual([
      { weight: 25, count: 2 },
      { weight: 10, count: 1 },
    ]);
  });

  it('has nothing to group on a bare bar', () => {
    expect(groupPlates([])).toEqual([]);
  });
});

describe('describePerSide', () => {
  it('reads a side out as it is loaded', () => {
    expect(describePerSide([25, 25, 10, 1.25])).toBe('2 × 25 + 10 + 1.25');
  });

  it('says so when there is nothing on the bar', () => {
    expect(describePerSide([])).toBe('Bar only');
  });
});

describe('clampBarWeight', () => {
  it('keeps a real bar as it is', () => {
    expect(clampBarWeight(7.5)).toBe(7.5);
  });

  it('pulls an impossible one back into range', () => {
    expect(clampBarWeight(500)).toBe(100);
    expect(clampBarWeight(-5)).toBe(0);
  });

  it('reads an unusable value as no bar at all', () => {
    expect(clampBarWeight(Number.NaN)).toBe(0);
  });
});

describe('normalisePlates', () => {
  it('drops a size that is not a plate', () => {
    // What `localStorage` can hold after a version that offered other sizes,
    // or after somebody edited it by hand.
    expect(normalisePlates([25, 3, 10], 'kg')).toEqual([25, 10]);
  });

  it('drops a plate belonging to the other unit', () => {
    // 20 is a kilogram plate. On a pound rack it is nothing.
    expect(normalisePlates([45, 20, 25], 'lb')).toEqual([45, 25]);
  });

  it('deduplicates and orders heaviest first', () => {
    expect(normalisePlates([5, 25, 5, 10], 'kg')).toEqual([25, 10, 5]);
  });
});
