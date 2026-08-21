'use client';

import { Barbell, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import { listBodyWeights } from '@/lib/db/bodyweight';
import { toLocalDate } from '@/lib/db/keys';
import { countSessionsByDate } from '@/lib/db/queries';
import type { LocalDate } from '@/lib/db/types';
import { gridBounds, monthGrid, monthOf, shiftMonth } from '@/lib/calendar';
import { formatNumber } from '@/lib/format';
import { toDisplayWeight } from '@/lib/units';
import { listTrainingBlocks } from '@/lib/db/training-blocks';
import { blockOn, currentBlock, tintByBlock } from '@/lib/training-block';
import { DayWeightSheet } from './day-weight-sheet';
import { TrainingBlockBar } from './training-block-bar';

const MONTH_LABEL = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/** Monday first, matching the grid. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * The month, day by day.
 *
 * Its reason to exist is the weight: it used to hang off a session, so you
 * could only record one on a day you trained. Weighing yourself is a morning
 * thing. Here every day is tappable, trained or not.
 *
 * Sessions are marked rather than detailed — History already lists them, and
 * repeating that here would make a worse version of a screen that works.
 */
export function CalendarView() {
  // Read once, in an initialiser rather than during render: the clock is not a
  // pure input, and "today" changing under a rendering component would be a
  // worse bug than a calendar that needs reopening after midnight.
  const [today] = useState(() => toLocalDate(Date.now()));
  const [month, setMonth] = useState(() => monthOf(today));
  const [editing, setEditing] = useState<LocalDate | null>(null);
  const [unit] = useWeightUnit();

  const grid = monthGrid(month);
  const { from, to } = gridBounds(grid);

  // One query for the whole grid, neighbouring days included, rather than one
  // per cell.
  const sessions = useLiveQuery(() => countSessionsByDate(from, to), [from, to]);
  const weights = useLiveQuery(async () => {
    const entries = await listBodyWeights(from, to);
    return new Map(entries.map((entry) => [entry.date, entry.weightKg]));
  }, [from, to]);

  const blocks = useLiveQuery(() => listTrainingBlocks(), []);
  const current = currentBlock(blocks ?? [], today);
  const tints = tintByBlock(blocks ?? []);

  const weightFor = (date: LocalDate) => weights?.get(date);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-raised px-2 py-2">
        <button
          type="button"
          onClick={() => setMonth((current) => shiftMonth(current, -1))}
          aria-label="Previous month"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <CaretLeft size={18} weight="bold" />
        </button>

        <h2 className="text-[0.9375rem] font-semibold text-ink">
          {MONTH_LABEL.format(new Date(month.year, month.month - 1, 1))}
        </h2>

        <button
          type="button"
          onClick={() => setMonth((current) => shiftMonth(current, 1))}
          aria-label="Next month"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <CaretRight size={18} weight="bold" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {/* Above the grid rather than inside it: the week count is the answer
            people came for, and hunting for it among coloured squares would be
            a detour. */}
        <TrainingBlockBar blocks={blocks ?? []} current={current} today={today} />

        <div className="mt-3 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day, index) => (
            <p
              key={`${day}-${index}`}
              aria-hidden
              className="pb-1 text-center text-[0.6875rem] font-semibold text-muted"
            >
              {day}
            </p>
          ))}

          {grid.flat().map((day) => {
            const weight = weightFor(day.date);
            const trained = (sessions?.get(day.date) ?? 0) > 0;
            const isToday = day.date === today;
            // A colour per block, which is the one place the single-accent
            // rule bends — and it bends because telling one cycle from the next
            // at a glance is the entire reason blocks are on a calendar. The
            // tints stay washed and low-chroma so the month still reads as one
            // surface, and the seam on a block's first day survives the palette
            // repeating past six.
            const dayBlock = blockOn(blocks ?? [], day.date);
            const startsBlock = dayBlock !== null && dayBlock.startsOn === day.date;
            const tint = dayBlock ? tints.get(dayBlock.id) : undefined;

            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setEditing(day.date)}
                aria-label={`${day.date}${dayBlock ? `, ${dayBlock.label}` : ''}${
                  trained ? ', trained' : ''
                }${
                  weight !== undefined ? `, ${formatNumber(toDisplayWeight(weight, unit))} ${unit}` : ''
                }`}
                className={`flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-control px-0.5 transition-transform active:scale-95 ${
                  day.inMonth ? (tint ?? 'bg-raised') : 'bg-transparent'
                } ${startsBlock ? 'border-l-2 border-ink' : ''} ${
                  isToday ? 'ring-2 ring-ink' : ''
                }`}
              >
                <span
                  className={`text-xs tabular-nums ${
                    day.inMonth ? 'text-ink' : 'text-muted opacity-40'
                  }`}
                >
                  {day.dayOfMonth}
                </span>

                {/* A session is marked, never counted: the number of sessions
                    in a day is not a fact anyone reads off a calendar. */}
                {trained ? (
                  <Barbell size={11} weight="fill" aria-hidden className="text-chart" />
                ) : null}

                {weight !== undefined ? (
                  <span className="font-mono text-[0.625rem] leading-none text-muted tabular-nums">
                    {formatNumber(toDisplayWeight(weight, unit))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <p className="mt-4 px-1 text-xs text-muted">
          Tap any day to record what you weighed. A day you trained is marked, and the
          blocks you have run are tinted, each starting at a marked edge.
        </p>
      </div>

      {editing !== null ? (
        <DayWeightSheet
          date={editing}
          weightKg={weightFor(editing)}
          unit={unit}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
