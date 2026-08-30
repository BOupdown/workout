import { describe, expect, it } from 'vitest';
import {
  gridBounds,
  monthBounds,
  monthGrid,
  monthOf,
  shiftMonth,
  shiftWeek,
  weekEnd,
  weekOf,
  weekStartOf,
} from '../lib/calendar';

const flat = (year: number, month: number) => monthGrid({ year, month }).flat();
const dates = (year: number, month: number) => flat(year, month).map((day) => day.date);

describe('monthGrid', () => {
  it('returns full weeks of seven days', () => {
    for (const [year, month] of [
      [2026, 1],
      [2026, 2],
      [2026, 8],
      [2024, 2],
    ] as const) {
      for (const week of monthGrid({ year, month })) {
        expect(week).toHaveLength(7);
      }
    }
  });

  it('starts every week on a Monday', () => {
    // `getDay()` rend 1 pour lundi.
    for (const week of monthGrid({ year: 2026, month: 8 })) {
      const [y, m, d] = week[0].date.split('-').map(Number);
      expect(new Date(y, m - 1, d).getDay()).toBe(1);
    }
  });

  it('covers every day of the month, exactly once', () => {
    const august = flat(2026, 8).filter((day) => day.inMonth);
    expect(august).toHaveLength(31);
    expect(new Set(august.map((day) => day.date)).size).toBe(31);
    expect(august[0].dayOfMonth).toBe(1);
    expect(august[30].dayOfMonth).toBe(31);
  });

  it('fills up with the neighbouring days rather than with blanks', () => {
    // Every cell is a real date: an empty one has nothing to show and nothing
    // to tap, and forces everything else to ask whether it is real.
    const grid = monthGrid({ year: 2026, month: 8 });
    const first = grid[0][0];

    expect(first.inMonth).toBe(false);
    expect(first.date).toBe('2026-07-27');
  });

  it('never leaves a hole in the run of days', () => {
    const all = dates(2026, 3);
    for (let i = 1; i < all.length; i += 1) {
      const [py, pm, pd] = all[i - 1].split('-').map(Number);
      const previous = new Date(py, pm - 1, pd);
      previous.setDate(previous.getDate() + 1);

      const [y, m, d] = all[i].split('-').map(Number);
      expect(new Date(y, m - 1, d).getTime()).toBe(previous.getTime());
    }
  });

  it('handles a leap February', () => {
    const february = flat(2024, 2).filter((day) => day.inMonth);
    expect(february).toHaveLength(29);
  });

  it('handles a February that is not a leap one', () => {
    expect(flat(2026, 2).filter((day) => day.inMonth)).toHaveLength(28);
  });

  it('does not add a whole week of the following month', () => {
    // February 2027 runs 28 days and starts on a Monday: exactly four rows,
    // not five with one of them entirely in March.
    const grid = monthGrid({ year: 2027, month: 2 });
    expect(grid).toHaveLength(4);
    expect(grid.flat().every((day) => day.inMonth)).toBe(true);
  });

  it('rolls the year over on December', () => {
    const december = flat(2026, 12);
    expect(december.some((day) => day.date.startsWith('2027-01'))).toBe(true);
    expect(december.filter((day) => day.inMonth)).toHaveLength(31);
  });

  it('rolls the year over on January', () => {
    const january = flat(2026, 1);
    expect(january.some((day) => day.date.startsWith('2025-12'))).toBe(true);
    expect(january.filter((day) => day.inMonth)).toHaveLength(31);
  });
});

describe('shiftMonth', () => {
  it('avance et recule', () => {
    expect(shiftMonth({ year: 2026, month: 8 }, 1)).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth({ year: 2026, month: 8 }, -1)).toEqual({ year: 2026, month: 7 });
  });

  it('rolls the year both ways', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('encaisse un grand saut', () => {
    expect(shiftMonth({ year: 2026, month: 8 }, -20)).toEqual({ year: 2024, month: 12 });
  });
});

describe('monthOf', () => {
  it('reads the month of a date', () => {
    expect(monthOf('2026-08-21')).toEqual({ year: 2026, month: 8 });
  });
});

describe('gridBounds', () => {
  it('returns the first and the last day on screen', () => {
    // This is what allows the database to be queried once for the whole grid,
    // neighbouring days included.
    const grid = monthGrid({ year: 2026, month: 8 });
    const { from, to } = gridBounds(grid);

    expect(from).toBe(grid[0][0].date);
    expect(to).toBe(grid[grid.length - 1][6].date);
    expect(from < to).toBe(true);
  });
});

describe('monthBounds', () => {
  it('bounds the month, leaving the neighbouring days out', () => {
    expect(monthBounds({ year: 2026, month: 8 })).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('knows the short months', () => {
    expect(monthBounds({ year: 2026, month: 4 }).to).toBe('2026-04-30');
  });

  it('knows the leap years', () => {
    // 2024 is a leap year, 2026 is not.
    expect(monthBounds({ year: 2024, month: 2 }).to).toBe('2024-02-29');
    expect(monthBounds({ year: 2026, month: 2 }).to).toBe('2026-02-28');
  });

  it('stays inside the month where the grid steps out of it', () => {
    // The difference between the two: the grid for August 2026 opens on 27
    // July, and a caption reading "August" must not plot that day.
    const grid = monthGrid({ year: 2026, month: 8 });

    expect(gridBounds(grid).from < monthBounds({ year: 2026, month: 8 }).from).toBe(true);
  });
});

describe('weekStartOf', () => {
  it('walks back to the Monday of the week', () => {
    // Sunday 30 August 2026 belongs to the week opening on the 24th.
    expect(weekStartOf('2026-08-30')).toBe('2026-08-24');
    expect(weekStartOf('2026-08-26')).toBe('2026-08-24');
  });

  it('leaves a Monday where it is', () => {
    expect(weekStartOf('2026-08-24')).toBe('2026-08-24');
  });

  it('keeps Sunday at the end of its week, not the start of the next', () => {
    // The one the `en-GB` week inherits and a `getDay()` of 0 invites getting
    // wrong: Sunday is day seven here.
    expect(weekEnd(weekStartOf('2026-08-30'))).toBe('2026-08-30');
  });

  it('reaches back into the previous month', () => {
    // Tuesday 1 September 2026 opens on Monday 31 August.
    expect(weekStartOf('2026-09-01')).toBe('2026-08-31');
  });
});

describe('shiftWeek', () => {
  it('moves a whole week either way', () => {
    expect(shiftWeek('2026-08-24', 1)).toBe('2026-08-31');
    expect(shiftWeek('2026-08-24', -1)).toBe('2026-08-17');
  });

  it('rolls over the year', () => {
    expect(shiftWeek('2025-12-29', 1)).toBe('2026-01-05');
    expect(shiftWeek('2026-01-05', -1)).toBe('2025-12-29');
  });

  it('crosses the clock changes', () => {
    // The two weeks that break under millisecond arithmetic in a zone that
    // observes daylight saving: adding 7 × 86 400 000 across the spring change
    // lands at 23:00 the evening before, which reads as the wrong day. Under
    // `TZ=UTC` this is ordinary arithmetic and proves nothing — which is why
    // it is written as dates rather than as a duration.
    expect(shiftWeek('2026-03-23', 1)).toBe('2026-03-30');
    expect(shiftWeek('2026-10-19', 1)).toBe('2026-10-26');
  });

  it('goes nowhere on a delta of zero', () => {
    expect(shiftWeek('2026-08-24', 0)).toBe('2026-08-24');
  });
});

describe('weekOf', () => {
  it('names the week an instant falls in', () => {
    expect(weekOf(new Date(2026, 7, 30, 18, 0).getTime())).toBe('2026-08-24');
  });
});
