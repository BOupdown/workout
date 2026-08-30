'use client';

import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { useWeeklyLoad } from '@/hooks/use-weekly-load';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import { toLocalDate, localMidnight } from '@/lib/db/keys';
import { shiftWeek, weekEnd, weekStartOf, type WeekStart } from '@/lib/calendar';
import { MUSCLE_GROUP_LABELS } from '@/lib/exercise-draft';
import { UNGROUPED_LABEL } from '@/lib/exercise-groups';
import { formatVolume } from '@/lib/format';
import { compareTrainingLoad, type MuscleGroupComparison } from '@/lib/training-load';
import { toDisplayWeight, type WeightUnit } from '@/lib/units';

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DAY_ONLY = new Intl.DateTimeFormat('en-GB', { day: 'numeric' });

/**
 * The week, muscle by muscle.
 *
 * The one reading a training log owes you that neither the curve nor the
 * calendar gives: **how many sets of each muscle**. Progression answers "is the
 * bench going up", the calendar answers "did I turn up", and between them sits
 * the question a programme is actually steered by — fourteen sets of back and
 * two of legs is a plan going wrong, and until now nothing here could say so.
 *
 * Always against the week before. A count on its own is a number; a count next
 * to last week's is a decision.
 */
export function WeeklyLoadScreen() {
  // The clock read once, in an initialiser: "this week" changing under a
  // rendering component would be a worse bug than a screen that needs
  // reopening after midnight on a Sunday.
  const [thisWeek] = useState<WeekStart>(() => weekStartOf(toLocalDate(Date.now())));
  const [week, setWeek] = useState<WeekStart>(thisWeek);

  const { loading, current, previous } = useWeeklyLoad(week);
  const [unit] = useWeightUnit();

  const rows = compareTrainingLoad(current, previous);
  // The bar scale. Taken over both weeks, so a row does not grow just because
  // the week it is compared with was quieter.
  const busiest = Math.max(1, ...rows.map((row) => Math.max(row.workSets, row.previousWorkSets)));

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-raised px-2 py-2">
        <button
          type="button"
          onClick={() => setWeek((from) => shiftWeek(from, -1))}
          aria-label="Previous week"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <CaretLeft size={18} weight="bold" />
        </button>

        <div className="min-w-0 text-center">
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">{weekLabel(week)}</h2>
          {week === thisWeek ? <p className="text-xs text-muted">This week</p> : null}
        </div>

        {/* Stopped at the current week rather than wrapping round: there is
            nothing to read in a week that has not happened, and a disabled
            control says that better than an empty screen would. */}
        <button
          type="button"
          onClick={() => setWeek((from) => shiftWeek(from, 1))}
          disabled={week >= thisWeek}
          aria-label="Next week"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95 disabled:opacity-30"
        >
          <CaretRight size={18} weight="bold" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-panel bg-line" />
            <div className="h-64 rounded-panel bg-line" />
          </div>
        ) : (
          <>
            <section className="rounded-panel bg-raised px-4 py-3.5">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-sm text-ink tabular-nums">
                <span>
                  {current.sessionCount} session{current.sessionCount === 1 ? '' : 's'}
                  <span className="text-muted"> · </span>
                  {current.workSets} work set{current.workSets === 1 ? '' : 's'}
                </span>
                <SetsDelta current={current.workSets} previous={previous.workSets} spelt />
              </p>

              <p className="mt-2.5 flex items-baseline gap-1.5 border-t border-line pt-2.5 text-sm">
                <span className="text-muted">Volume</span>
                <span className="font-mono font-semibold text-ink tabular-nums">
                  {formatVolume(toDisplayWeight(current.volumeKg, unit))} {unit}
                </span>
              </p>
              {/* Said here rather than left to be discovered: a back day of
                  pull-ups adds sets and no tonnage, and a total that quietly
                  skips half a session is the kind of number a programme gets
                  built on. */}
              <p className="mt-1.5 text-xs text-muted">
                Load × reps, over barbell and machine work. Bodyweight, weighted and assisted sets
                count as sets and carry no tonnage.
              </p>
            </section>

            {rows.length === 0 ? (
              <p className="rounded-panel bg-raised px-4 py-10 text-center text-sm text-muted">
                Nothing logged this week.
              </p>
            ) : (
              <section className="rounded-panel bg-raised px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-semibold text-muted uppercase">Sets per muscle</h3>
                  {/* Said once, at the top, rather than after every row: eight
                      repetitions of "vs last week" is a column heading written
                      eight times. */}
                  <span className="text-[0.6875rem] text-muted">vs last week</span>
                </div>
                <ul className="mt-3 space-y-3.5">
                  {rows.map((row) => (
                    <MuscleRow key={row.group ?? 'none'} row={row} busiest={busiest} unit={unit} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One muscle: what it got, what it got last week, and a bar to compare the
 * rows against each other at a glance.
 */
function MuscleRow({
  row,
  busiest,
  unit,
}: {
  row: MuscleGroupComparison;
  busiest: number;
  unit: WeightUnit;
}) {
  const label = row.group === null ? UNGROUPED_LABEL : MUSCLE_GROUP_LABELS[row.group];

  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{label}</span>
        <span className="flex shrink-0 items-baseline gap-2">
          <SetsDelta current={row.workSets} previous={row.previousWorkSets} />
          <span className="font-mono text-sm font-semibold text-ink tabular-nums">
            {row.workSets}
          </span>
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div
          aria-hidden
          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface"
        >
          <div
            className="h-full rounded-full bg-chart"
            style={{ width: `${(row.workSets / busiest) * 100}%` }}
          />
        </div>
        {row.volumeKg > 0 ? (
          <span className="shrink-0 font-mono text-[0.6875rem] text-muted tabular-nums">
            {formatVolume(toDisplayWeight(row.volumeKg, unit))} {unit}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The difference with the week before.
 *
 * Deliberately **not** the accent green the progression badge wears. More sets
 * is not better — a deload week is meant to drop — and painting a rise as a win
 * would have the screen cheering for the one thing a planned back-off is trying
 * to do.
 */
function SetsDelta({
  current,
  previous,
  spelt,
}: {
  current: number;
  previous: number;
  /** Says what it is counting. For the summary, which has no column heading. */
  spelt?: boolean;
}) {
  const delta = current - previous;
  if (delta === 0) return null;

  return (
    <span className="shrink-0 font-mono text-[0.6875rem] text-muted tabular-nums">
      {delta > 0 ? '+' : '−'}
      {Math.abs(delta)}
      {spelt ? ' sets vs last week' : ''}
    </span>
  );
}

/** `1 – 7 Sep`, or `25 Aug – 1 Sep` when the week straddles two months. */
function weekLabel(start: WeekStart): string {
  const from = localMidnight(start);
  const to = localMidnight(weekEnd(start));

  const sameMonth = new Date(from).getMonth() === new Date(to).getMonth();
  const opening = sameMonth ? DAY_ONLY.format(from) : DAY_MONTH.format(from);

  return `${opening} – ${DAY_MONTH.format(to)}`;
}
