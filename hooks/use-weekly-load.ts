'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { shiftWeek, weekEnd, type WeekStart } from '@/lib/calendar';
import { EMPTY_PERIOD_LOAD, readTrainingLoad, type PeriodLoad } from '@/lib/db/queries';

export interface WeeklyLoad {
  loading: boolean;
  current: PeriodLoad;
  /** The week before, which is what makes any of the current one readable. */
  previous: PeriodLoad;
}

/**
 * A week's training load, and the one before it.
 *
 * Both in a single live query rather than two: they are read together, drawn
 * together, and a re-render that had one of them fresh and the other stale
 * would print a difference that was never true of any moment.
 */
export function useWeeklyLoad(week: WeekStart): WeeklyLoad {
  const loads = useLiveQuery(async () => {
    const before = shiftWeek(week, -1);

    return Promise.all([
      readTrainingLoad(week, weekEnd(week)),
      readTrainingLoad(before, weekEnd(before)),
    ]);
  }, [week]);

  if (loads === undefined) {
    return { loading: true, current: EMPTY_PERIOD_LOAD, previous: EMPTY_PERIOD_LOAD };
  }

  return { loading: false, current: loads[0], previous: loads[1] };
}
