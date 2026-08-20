'use client';

import { ArrowLeft, PencilSimple, TrendUp } from '@phosphor-icons/react';
import { useExerciseProgression } from '@/hooks/use-exercise-progression';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import type { Exercise } from '@/lib/db/types';
import { describeSet, formatDuration, formatNumber } from '@/lib/format';
import type { ProgressionMetric } from '@/lib/progression';
import { toDisplayWeight } from '@/lib/units';
import { ProgressionChart } from './progression-chart';

interface ProgressionSheetProps {
  exercise: Exercise;
  /** Absent inside a session: editing the catalogue is not a between-sets gesture. */
  onEdit?: () => void;
  onClose: () => void;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/**
 * An exercise's progression over time.
 *
 * Three levels of reading, fastest to fullest: the headline figure, the curve,
 * then the session-by-session table. The table is not decorative padding - it
 * is what guarantees no value is reachable only through the chart's tooltip.
 */
export function ProgressionSheet({ exercise, onEdit, onClose }: ProgressionSheetProps) {
  const { loading, points, metric, delta, recentSets } = useExerciseProgression(exercise);
  const [unit] = useWeightUnit();

  const unitLabel: Record<ProgressionMetric, string> = {
    weightKg: unit,
    reps: 'reps',
    durationSec: '',
  };

  const format = (value: number) =>
    metric === 'durationSec'
      ? formatDuration(value)
      : formatNumber(metric === 'weightKg' ? toDisplayWeight(value, unit) : value);

  const label = unitLabel[metric];
  const latest = points[points.length - 1];
  const best = points.reduce<typeof latest | undefined>(
    (top, point) => (!top || point.value > top.value ? point : top),
    undefined,
  );

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close progression"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">{exercise.name}</h2>
          <p className="text-xs text-muted">
            {exercise.archivedAt !== undefined ? 'Archived' : 'Progression'}
          </p>
        </div>

        {/* The way into the catalogue: you notice the typo while reading the
            curve, which is where the name is under your eyes. */}
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${exercise.name}`}
            className="mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
          >
            <PencilSimple size={19} weight="bold" />
          </button>
        ) : null}
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {loading ? (
          <div className="space-y-3">
            <div className="h-28 rounded-panel bg-line" />
            <div className="h-48 rounded-panel bg-line" />
          </div>
        ) : points.length === 0 ? (
          <div className="rounded-panel bg-raised px-4 py-10 text-center">
            <TrendUp size={28} weight="duotone" className="mx-auto text-muted" />
            <p className="mt-3 text-sm font-medium text-ink">No work sets yet</p>
            <p className="mt-1 text-sm text-muted">
              Log a set and your progression will show up here.
            </p>
          </div>
        ) : (
          <>
            <section className="rounded-panel bg-raised px-4 py-4">
              <p className="text-xs text-muted">Last session</p>
              {/* Headline figure: proportional figures, not `tabular-nums`. At
                  this size, equal-width digits read loose. */}
              <p className="mt-1 flex items-baseline gap-1.5 text-5xl leading-none font-semibold text-ink">
                {format(latest.value)}
                {label ? <span className="text-lg font-medium text-muted">{label}</span> : null}
                {latest.reps !== undefined ? (
                  <span className="text-lg font-medium text-muted">× {latest.reps}</span>
                ) : null}
              </p>

              <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {delta !== null ? (
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono font-semibold tabular-nums ${
                      delta > 0
                        ? 'bg-accent text-accent-ink'
                        : delta < 0
                          ? 'bg-line text-ink'
                          : 'bg-line text-muted'
                    }`}
                  >
                    {delta > 0 ? '+' : ''}
                    {format(delta)} {label}
                  </span>
                ) : null}
                <span>
                  {delta !== null ? 'vs previous session · ' : ''}
                  best {best ? format(best.value) : '—'} {label}
                </span>
              </p>
            </section>

            {points.length > 1 ? (
              <section className="rounded-panel bg-raised px-3 py-3">
                <ProgressionChart points={points} metric={metric} unit={unit} label={label} />
              </section>
            ) : (
              <p className="px-1 text-xs text-muted">
                The curve appears from your second session on this exercise.
              </p>
            )}

            <section className="overflow-hidden rounded-panel bg-raised">
              <h3 className="px-4 pt-3.5 pb-1 text-xs font-semibold text-muted uppercase">
                Session by session
              </h3>
              <ul>
                {[...points].reverse().map((point) => {
                  const sessionSets = recentSets.filter((s) => s.sessionId === point.sessionId);
                  return (
                    <li
                      key={point.sessionId}
                      className="border-t border-line px-4 py-3 first:border-t-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium text-ink">
                          {DATE_FORMAT.format(point.performedAt)}
                        </span>
                        <span className="font-mono text-sm font-semibold text-ink tabular-nums">
                          {format(point.value)} {label}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs text-muted tabular-nums">
                        {sessionSets.map((set) => {
                          const { primary, secondary } = describeSet(set, exercise, unit);
                          return (
                            <span key={set.id}>
                              {primary}
                              {secondary ? ` ${secondary}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
