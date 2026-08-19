'use client';

import { describeSet } from '@/lib/format';
import type { Exercise, SessionExerciseWithSets, SetEntry } from '@/lib/db/types';
import type { WeightUnit } from '@/lib/units';

interface ExerciseRowProps {
  entry: SessionExerciseWithSets;
  isActive: boolean;
  onSelect: () => void;
  unit: WeightUnit;
  /** The set just logged, to be brought in. */
  justLoggedSetId?: string;
}

/**
 * One exercise of the session and its sets.
 *
 * Sets are laid out as tiles rather than a run of text: the value that
 * progresses is the content of this screen, and it has to read at a glance, at
 * arm's length, between two sets. Warm-ups sit back without disappearing.
 *
 * The active exercise is marked by an accent bar and a tinted background, not a
 * full inversion: inverting crushed the legibility of the numbers.
 */
export function ExerciseRow({ entry, isActive, onSelect, unit, justLoggedSetId }: ExerciseRowProps) {
  const { exercise, sets } = entry;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isActive}
      className={`relative w-full overflow-hidden rounded-panel border px-4 py-3.5 text-left transition-transform active:scale-[0.99] ${
        isActive ? 'border-accent bg-accent-wash' : 'border-transparent bg-raised'
      }`}
    >
      {isActive ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-accent" />
      ) : null}

      <div className="flex min-h-6 items-baseline justify-between gap-3">
        <span className="truncate text-[0.9375rem] font-semibold text-ink">{exercise.name}</span>
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          {sets.length > 0 ? `${sets.length} ×` : 'to do'}
        </span>
      </div>

      {sets.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {sets.map((set) => (
            <SetTile
              key={set.id}
              set={set}
              exercise={exercise}
              unit={unit}
              isActive={isActive}
              justLogged={set.id === justLoggedSetId}
            />
          ))}
        </ul>
      ) : null}
    </button>
  );
}

function SetTile({
  set,
  exercise,
  unit,
  isActive,
  justLogged,
}: {
  set: SetEntry;
  exercise: Exercise;
  unit: WeightUnit;
  isActive: boolean;
  justLogged: boolean;
}) {
  const { primary, secondary } = describeSet(set, exercise, unit);
  const isWarmup = set.kind === 'warmup';

  // On the active row the background is already tinted: tiles go white to stay
  // detached rather than blending in.
  const background = isActive ? 'bg-raised' : 'bg-surface';

  return (
    <li
      className={`flex items-baseline gap-1 rounded-control px-2.5 py-1.5 font-mono tabular-nums ${background} ${
        isWarmup ? 'text-muted' : 'text-ink'
      } ${justLogged ? 'animate-set-logged' : ''}`}
    >
      <span className={isWarmup ? 'text-sm' : 'text-base font-semibold'}>{primary}</span>
      {secondary ? <span className="text-xs text-muted">{secondary}</span> : null}
      {isWarmup ? <span className="sr-only">(warm-up)</span> : null}
    </li>
  );
}
