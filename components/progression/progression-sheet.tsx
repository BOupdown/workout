'use client';

import { ArrowLeft, Medal, PencilSimple, TrendUp } from '@phosphor-icons/react';
import { useState } from 'react';
import { useExerciseProgression } from '@/hooks/use-exercise-progression';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import type { Exercise } from '@/lib/db/types';
import { formatDuration, formatNumber, formatSetSummary } from '@/lib/format';
import { MAX_ESTIMABLE_REPS, supportsOneRepMax } from '@/lib/one-rep-max';
import type { ProgressionMetric, ProgressionView } from '@/lib/progression';
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
const VIEW_LABELS: Record<ProgressionView, string> = {
  measured: 'Load',
  oneRepMax: 'Est. 1RM',
};

const VIEWS = Object.keys(VIEW_LABELS) as ProgressionView[];

export function ProgressionSheet({ exercise, onEdit, onClose }: ProgressionSheetProps) {
  /*
   * Component state, not a stored preference.
   *
   * The measured curve is what the app is for, and an estimate is something you
   * go and ask for. Persisting the switch would mean opening this screen one
   * morning to a number nobody lifted, with no memory of having asked for it.
   */
  const [view, setView] = useState<ProgressionView>('measured');
  const estimable = supportsOneRepMax(exercise);
  const estimating = estimable && view === 'oneRepMax';

  const { loading, points, metric, delta, recentSets } = useExerciseProgression(exercise, view);
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
            {/* The curve plots reps for some exercises, and "12" means twelve a
                side on a unilateral one. Without this the axis is ambiguous. */}
            {exercise.perSide ? ' · counted per side' : ''}
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
        {/* Above everything it governs, and outside the branch below: switching
            back has to stay possible from the empty state the switch itself can
            produce. */}
        {estimable && !loading ? (
          <section className="rounded-panel bg-raised px-3 py-3">
            <div className="flex gap-1.5" role="group" aria-label="What the curve plots">
              {VIEWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  aria-pressed={view === option}
                  className={`h-12 flex-1 rounded-control border-2 text-[0.9375rem] font-semibold transition-transform active:scale-[0.98] ${
                    view === option
                      ? 'border-ink bg-raised text-ink'
                      : 'border-transparent bg-surface text-muted'
                  }`}
                >
                  {VIEW_LABELS[option]}
                </button>
              ))}
            </div>

            {/* Said plainly, and every time the estimate is on screen. The rest
                of this app shows what was performed; this one number does not,
                and that is not a detail to leave to a help page. */}
            {estimating ? (
              <p className="mt-2 px-1 text-xs text-muted">
                Brzycki, from work sets of {MAX_ESTIMABLE_REPS} reps or fewer. A model, not
                a measurement — nothing below was lifted.
              </p>
            ) : null}
          </section>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            <div className="h-28 rounded-panel bg-line" />
            <div className="h-48 rounded-panel bg-line" />
          </div>
        ) : points.length === 0 ? (
          <div className="rounded-panel bg-raised px-4 py-10 text-center">
            <TrendUp size={28} weight="duotone" className="mx-auto text-muted" />
            {/* Two different absences, and telling them apart is the whole
                value: one says log a set, the other says the sets are there and
                the formula will not read them. */}
            {estimating && recentSets.length > 0 ? (
              <>
                <p className="mt-3 text-sm font-medium text-ink">Nothing to estimate from</p>
                <p className="mt-1 text-sm text-muted">
                  No work set here is inside the range — the formula stops at{' '}
                  {MAX_ESTIMABLE_REPS} reps, and needs a load above zero.
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium text-ink">No work sets yet</p>
                <p className="mt-1 text-sm text-muted">
                  Log a set and your progression will show up here.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <section className="rounded-panel bg-raised px-4 py-4">
              <p className="text-xs text-muted">Last session</p>
              {/* Headline figure: proportional figures, not `tabular-nums`. At
                  this size, equal-width digits read loose. */}
              <p className="mt-1 flex items-baseline gap-1.5 text-5xl leading-none font-semibold text-ink">
                {/* Reps lead, as they do everywhere a set is shown and as they
                    are typed. The load keeps the headline size: it is the
                    number this whole screen plots.

                    Not under an estimate, though: "5 × 112.5" would read as
                    five reps at 112.5, which is precisely the set that was not
                    performed. The reps move down to the line below, where they
                    can say what they are. */}
                {!estimating && latest.reps !== undefined ? (
                  <span className="text-lg font-medium text-muted">{latest.reps} ×</span>
                ) : null}
                {format(latest.value)}
                {label ? <span className="text-lg font-medium text-muted">{label}</span> : null}
              </p>

              {estimating && latest.fromWeightKg !== undefined ? (
                <p className="mt-1.5 font-mono text-xs text-muted tabular-nums">
                  from {latest.reps} × {format(latest.fromWeightKg)} {label}
                </p>
              ) : null}

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
                {delta !== null ? <span>vs previous session</span> : null}
              </p>

              {/* The record deserves its own line rather than a trailing aside:
                  seeing progression over time is the point of the app, and this
                  is the single number that says how far it got. */}
              {best ? (
                <p className="mt-3 flex items-baseline gap-1.5 border-t border-line pt-3 text-sm">
                  <Medal size={15} weight="fill" aria-hidden className="self-center text-chart" />
                  {/* "Record" is a fact about a set that was logged; the best
                      estimate is not one, and calling it a record would put the
                      medal on a lift nobody made. */}
                  <span className="text-muted">{estimating ? 'Best estimate' : 'Record'}</span>
                  <span className="font-mono font-semibold text-ink tabular-nums">
                    {!estimating && best.reps !== undefined ? `${best.reps} × ` : ''}
                    {format(best.value)} {label}
                  </span>
                  <span className="text-muted">{DATE_FORMAT.format(best.performedAt)}</span>
                </p>
              ) : null}
            </section>

            {points.length > 1 ? (
              <section className="rounded-panel bg-raised px-3 py-3">
                <ProgressionChart
                  points={points}
                  metric={metric}
                  unit={unit}
                  label={label}
                  caption={
                    estimating
                      ? 'One tick per session, best estimate.'
                      : 'One tick per session, best work set.'
                  }
                />
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
                          return <span key={set.id}>{formatSetSummary(set, exercise, unit)}</span>;
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
