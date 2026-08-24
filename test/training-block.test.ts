import { describe, expect, it } from 'vitest';
import {
  blockOn,
  blockProgressOn,
  covers,
  currentBlock,
  daysBetween,
  orderBlocks,
  overlaps,
  tintByBlock,
  CYCLE_TINTS,
  type TrainingBlock,
} from '../lib/training-block';

/**
 * `createdAt` increases with each call, so blocks written in source order model
 * blocks entered as they happen. It used to be one fixed instant for all of
 * them, which was harmless while tints keyed on the start date — and stopped
 * being harmless the moment they keyed on creation, since every block then
 * sorted on the id tie-break and "no two neighbouring tints" held by luck of
 * the alphabet rather than by construction.
 */
let created = 1_700_000_000_000;

const block = (
  label: string,
  startsOn: string,
  endsOn: string,
  createdAt = (created += 1_000),
): TrainingBlock => ({
  id: label.toLowerCase(),
  label,
  startsOn,
  endsOn,
  createdAt,
});

// Four weeks, then four weeks, with a fortnight of nothing in between.
const strength = block('Strength', '2026-08-03', '2026-08-30');
const hypertrophy = block('Hypertrophy', '2026-09-14', '2026-10-11');

describe('daysBetween', () => {
  it('counts the days between two dates', () => {
    expect(daysBetween('2026-08-03', '2026-08-10')).toBe(7);
  });

  it('returns zero for the same day', () => {
    expect(daysBetween('2026-08-03', '2026-08-03')).toBe(0);
  });

  it('crosses a month and a year', () => {
    expect(daysBetween('2026-12-25', '2027-01-01')).toBe(7);
  });

  it('stays right across the spring clock change', () => {
    // On Sunday 29 March 2026, one day runs 23 hours in Europe. A division
    // without rounding would report 6 days for a full week.
    expect(daysBetween('2026-03-25', '2026-04-01')).toBe(7);
  });

  it('stays right across the autumn clock change', () => {
    expect(daysBetween('2026-10-21', '2026-10-28')).toBe(7);
  });
});

describe('covers', () => {
  it('inclut les deux bornes', () => {
    expect(covers(strength, '2026-08-03')).toBe(true);
    expect(covers(strength, '2026-08-30')).toBe(true);
  });

  it('leaves out the day before and the day after', () => {
    expect(covers(strength, '2026-08-02')).toBe(false);
    expect(covers(strength, '2026-08-31')).toBe(false);
  });
});

describe('blockOn', () => {
  const all = [hypertrophy, strength];

  it('returns the block from its first day', () => {
    expect(blockOn(all, '2026-08-03')?.label).toBe('Strength');
  });

  it('returns the block up to and including its last day', () => {
    expect(blockOn(all, '2026-08-30')?.label).toBe('Strength');
  });

  it('returns null in a gap between two blocks', () => {
    // The price of the end date: days belonging to no block exist. They are
    // ordinary days, not an error.
    expect(blockOn(all, '2026-09-01')).toBeNull();
  });

  it('returns null before the first and after the last', () => {
    expect(blockOn(all, '2026-07-01')).toBeNull();
    expect(blockOn(all, '2026-12-01')).toBeNull();
  });

  it('ignores the order the list arrives in', () => {
    expect(blockOn([hypertrophy, strength], '2026-09-20')?.label).toBe('Hypertrophy');
  });

  it('rend null sans aucun bloc', () => {
    expect(blockOn([], '2026-08-03')).toBeNull();
  });
});

describe('overlaps', () => {
  const all = [strength, hypertrophy];

  it('lets through a block placed in a gap', () => {
    expect(overlaps(all, { startsOn: '2026-08-31', endsOn: '2026-09-13' })).toBeNull();
  });

  it('refuse un bloc englobant', () => {
    expect(overlaps(all, { startsOn: '2026-07-01', endsOn: '2026-12-01' })?.label).toBe(
      'Strength',
    );
  });

  it('refuses an overlap at the end', () => {
    expect(overlaps(all, { startsOn: '2026-07-20', endsOn: '2026-08-05' })?.label).toBe(
      'Strength',
    );
  });

  it('refuses an overlap at the start', () => {
    expect(overlaps(all, { startsOn: '2026-08-25', endsOn: '2026-09-05' })?.label).toBe(
      'Strength',
    );
  });

  it('refuses a block contained in another', () => {
    expect(overlaps(all, { startsOn: '2026-08-10', endsOn: '2026-08-12' })?.label).toBe(
      'Strength',
    );
  });

  it('refuses a block sharing a single day', () => {
    // The edge case: starting the very day the previous one ends.
    expect(overlaps(all, { startsOn: '2026-08-30', endsOn: '2026-09-10' })?.label).toBe(
      'Strength',
    );
  });

  it('accepts starting the day after that end', () => {
    expect(overlaps(all, { startsOn: '2026-08-31', endsOn: '2026-09-10' })).toBeNull();
  });

  it('can ignore itself, for an edit', () => {
    expect(overlaps(all, strength, strength.id)).toBeNull();
  });
});

describe('blockProgressOn', () => {
  const all = [strength, hypertrophy];

  it('counts the first week from one', () => {
    const progress = blockProgressOn(all, '2026-08-03');
    expect(progress?.daysIn).toBe(0);
    expect(progress?.week).toBe(1);
  });

  it('stays in week 1 up to the seventh day', () => {
    expect(blockProgressOn(all, '2026-08-09')?.week).toBe(1);
  });

  it('moves into week 2 on the eighth day', () => {
    expect(blockProgressOn(all, '2026-08-10')?.week).toBe(2);
  });

  it('announces the total length', () => {
    // Twenty-eight days make four weeks, and that is what allows "week 2 of 4"
    // instead of "week 2".
    expect(blockProgressOn(all, '2026-08-10')?.totalWeeks).toBe(4);
  });

  it('rounds an incomplete length up', () => {
    const short = block('Peaking', '2026-11-02', '2026-11-11'); // dix jours
    expect(blockProgressOn([short], '2026-11-02')?.totalWeeks).toBe(2);
  });

  it('counts the days left, the last one counting as zero', () => {
    expect(blockProgressOn(all, '2026-08-30')?.daysLeft).toBe(0);
    expect(blockProgressOn(all, '2026-08-29')?.daysLeft).toBe(1);
  });

  it('never runs past the length it announced', () => {
    const progress = blockProgressOn(all, '2026-08-30');
    expect(progress!.week).toBeLessThanOrEqual(progress!.totalWeeks);
  });

  it('returns null in a gap', () => {
    expect(blockProgressOn(all, '2026-09-01')).toBeNull();
  });
});

describe('currentBlock', () => {
  it('returns the block covering today', () => {
    expect(currentBlock([strength, hypertrophy], '2026-08-20')?.block.label).toBe('Strength');
  });

  it('ignores a block planned for later', () => {
    expect(currentBlock([hypertrophy], '2026-08-20')).toBeNull();
  });

  it('ignores a block that is already over', () => {
    expect(currentBlock([strength], '2026-09-20')).toBeNull();
  });
});

describe('orderBlocks', () => {
  it('sorts by start date', () => {
    expect(orderBlocks([hypertrophy, strength]).map((b) => b.label)).toEqual([
      'Strength',
      'Hypertrophy',
    ]);
  });

  it('leaves the list it was given alone', () => {
    const input = [hypertrophy, strength];
    orderBlocks(input);
    expect(input.map((b) => b.label)).toEqual(['Hypertrophy', 'Strength']);
  });
});

describe('tintByBlock', () => {
  it('gives two neighbouring blocks different tints', () => {
    // That is the whole job: telling one period from the next.
    const tints = tintByBlock([strength, hypertrophy]);
    expect(tints.get(strength.id)).not.toBe(tints.get(hypertrophy.id));
  });

  it('does not depend on the order of the array it is given', () => {
    const forward = tintByBlock([strength, hypertrophy]);
    const backward = tintByBlock([hypertrophy, strength]);

    expect(backward.get(strength.id)).toBe(forward.get(strength.id));
    expect(backward.get(hypertrophy.id)).toBe(forward.get(hypertrophy.id));
  });

  it('does not repaint a block when an older one is recorded', () => {
    // The flaw this change fixes: the tint followed the block's rank in the
    // list, so recording a July cycle after the fact pushed every later one
    // along — and a cycle learned as green came back yellow.
    const before = tintByBlock([strength, hypertrophy]);

    // Created now, but started before the other two.
    const deload = block('Deload', '2026-07-01', '2026-07-14');
    const after = tintByBlock([deload, strength, hypertrophy]);

    expect(after.get(strength.id)).toBe(before.get(strength.id));
    expect(after.get(hypertrophy.id)).toBe(before.get(hypertrophy.id));
  });

  it('still gives the newcomer a tint of its own', () => {
    const deload = block('Deload2', '2026-07-01', '2026-07-14');
    const tints = tintByBlock([deload, strength, hypertrophy]);

    expect(new Set(tints.values()).size).toBe(3);
  });

  it('gives the first block the accent tint already in place', () => {
    // Somebody with a single cycle sees exactly what they saw before.
    expect(tintByBlock([strength]).get(strength.id)).toBe(CYCLE_TINTS[0]);
  });

  it('wraps past the palette, leaving no block without a tint', () => {
    const many = Array.from({ length: 15 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return block(`B${i}`, `2026-01-${day}`, `2026-01-${day}`);
    });

    const tints = tintByBlock(many);
    expect(tints.size).toBe(15);
    for (const value of tints.values()) {
      expect(CYCLE_TINTS).toContain(value);
    }
  });

  it('never lets the same tint follow itself', () => {
    const many = Array.from({ length: 13 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return block(`B${i}`, `2026-01-${day}`, `2026-01-${day}`);
    });

    const tints = tintByBlock(many);
    const inOrder = orderBlocks(many).map((b) => tints.get(b.id));
    for (let i = 1; i < inOrder.length; i += 1) {
      expect(inOrder[i]).not.toBe(inOrder[i - 1]);
    }
  });
});
