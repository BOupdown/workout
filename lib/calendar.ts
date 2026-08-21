/**
 * Laying out a month.
 *
 * Kept apart from the screen because calendars are where off-by-one errors
 * live: the first of the month lands on a different weekday every time, weeks
 * start on Monday here and on Sunday elsewhere, and February moves. None of
 * that needs a DOM to be checked.
 *
 * Everything is built through the local-date helpers rather than by string
 * arithmetic, so a month boundary and a daylight-saving change are the same
 * problem — already solved once, in `./db/keys`.
 */

import { toLocalDate } from './db/keys';
import type { LocalDate } from './db/types';

/** Weeks start on Monday, as the app's `en-GB` formatting already assumes. */
const DAYS_IN_WEEK = 7;

export interface CalendarDay {
  date: LocalDate;
  dayOfMonth: number;
  /** `false` for the neighbouring days that pad the first and last weeks. */
  inMonth: boolean;
}

/** A month, as complete weeks of seven days. */
export type MonthGrid = CalendarDay[][];

export interface YearMonth {
  year: number;
  /** 1–12, as people write it, not 0–11 as `Date` does. */
  month: number;
}

const dayFrom = (date: Date, month: number): CalendarDay => ({
  date: toLocalDate(date.getTime()),
  dayOfMonth: date.getDate(),
  inMonth: date.getMonth() + 1 === month,
});

/**
 * Every week the month touches, padded with its neighbours' days.
 *
 * Padded rather than left blank so each cell is a real date: a blank has no
 * weight to show and nothing to tap, and the moment one exists the rest of the
 * screen has to keep asking whether a cell is real.
 */
export function monthGrid({ year, month }: YearMonth): MonthGrid {
  const first = new Date(year, month - 1, 1);

  // `getDay()` is 0 for Sunday; shift so Monday is 0 and Sunday is 6.
  const lead = (first.getDay() + 6) % DAYS_IN_WEEK;

  const cursor = new Date(year, month - 1, 1 - lead);
  const weeks: MonthGrid = [];

  // Stop once the cursor has left the month *and* a week is complete, which is
  // what makes a 28-day February starting on a Monday produce four rows rather
  // than a fifth full of the next month.
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < DAYS_IN_WEEK; i += 1) {
      week.push(dayFrom(cursor, month));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getMonth() + 1 === month || (cursor.getFullYear() < year && month === 12));

  return weeks;
}

/** The month `delta` months away, rolling the year over. */
export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const shifted = new Date(year, month - 1 + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() + 1 };
}

/** The month a given day belongs to. */
export function monthOf(date: LocalDate): YearMonth {
  const [year, month] = date.split('-').map(Number);
  return { year, month };
}

/** The first and last day the grid covers, for querying a range in one go. */
export function gridBounds(grid: MonthGrid): { from: LocalDate; to: LocalDate } {
  const first = grid[0][0];
  const lastWeek = grid[grid.length - 1];
  return { from: first.date, to: lastWeek[lastWeek.length - 1].date };
}
