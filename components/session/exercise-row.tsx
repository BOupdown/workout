'use client';

import { ArrowDown, ArrowUp, Trash } from '@phosphor-icons/react';
import { describeSet } from '@/lib/format';
import type { Exercise, SessionExerciseWithSets, SetEntry } from '@/lib/db/types';
import type { WeightUnit } from '@/lib/units';

interface ExerciseRowProps {
  entry: SessionExerciseWithSets;
  isActive: boolean;
  onSelect: () => void;
  /** Opens the editor for one set. Only reachable on the active row. */
  onEditSet: (set: SetEntry) => void;
  onRemove: () => void;
  /** Absent when the session holds a single exercise: nothing to reorder. */
  onMove?: (direction: -1 | 1) => void;
  isFirst?: boolean;
  isLast?: boolean;
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
 *
 * The row is no longer a single button — a set has to be editable — but every
 * part of it stays tappable. On an inactive row a tile *selects* the exercise,
 * as the rest of the row does; it only opens the editor once the row is
 * active. Without that, aiming for the row and landing on a tile would open a
 * sheet instead of selecting, and the two-tap entry would be gone.
 */
export function ExerciseRow({
  entry,
  isActive,
  onSelect,
  onEditSet,
  onRemove,
  onMove,
  isFirst = false,
  isLast = false,
  unit,
  justLoggedSetId,
}: ExerciseRowProps) {
  const { exercise, sets } = entry;

  return (
    <div
      className={`relative overflow-hidden rounded-panel border px-4 py-3.5 ${
        isActive ? 'border-accent bg-accent-wash' : 'border-transparent bg-raised'
      }`}
    >
      {isActive ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-accent" />
      ) : null}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={isActive}
          className="flex min-h-6 min-w-0 flex-1 items-baseline justify-between gap-3 text-left transition-transform active:scale-[0.99]"
        >
          <span className="truncate text-[0.9375rem] font-semibold text-ink">{exercise.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
            {sets.length > 0 ? `${sets.length} ×` : 'to do'}
          </span>
        </button>

        {/* Both arrows are always drawn, the unusable one disabled rather than
            removed: dropping it would slide the trash under the thumb that was
            aiming at "down". */}
        {isActive && onMove ? (
          <>
            <button
              type="button"
              disabled={isFirst}
              onClick={() => onMove(-1)}
              aria-label={`Move ${exercise.name} up`}
              className="-my-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-control text-muted transition-transform active:scale-90 disabled:opacity-30"
            >
              <ArrowUp size={17} weight="bold" />
            </button>
            <button
              type="button"
              disabled={isLast}
              onClick={() => onMove(1)}
              aria-label={`Move ${exercise.name} down`}
              className="-my-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-control text-muted transition-transform active:scale-90 disabled:opacity-30"
            >
              <ArrowDown size={17} weight="bold" />
            </button>
          </>
        ) : null}

        {/* Only on the active row: one exercise at a time can be removed, and
            the icon does not clutter the four others. */}
        {isActive ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${exercise.name} from the session`}
            className="-my-2 -mr-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-control text-muted transition-transform active:scale-90"
          >
            <Trash size={17} />
          </button>
        ) : null}
      </div>

      {sets.length > 0 ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {sets.map((set, index) => (
            <SetTile
              key={set.id}
              set={set}
              position={index + 1}
              exercise={exercise}
              unit={unit}
              isActive={isActive}
              justLogged={set.id === justLoggedSetId}
              onPress={() => (isActive ? onEditSet(set) : onSelect())}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SetTile({
  set,
  position,
  exercise,
  unit,
  isActive,
  justLogged,
  onPress,
}: {
  set: SetEntry;
  position: number;
  exercise: Exercise;
  unit: WeightUnit;
  isActive: boolean;
  justLogged: boolean;
  onPress: () => void;
}) {
  const { primary, secondary } = describeSet(set, exercise, unit);
  const isWarmup = set.kind === 'warmup';

  // On the active row the background is already tinted: tiles go white to stay
  // detached rather than blending in.
  const background = isActive ? 'bg-raised' : 'bg-surface';

  return (
    <li>
      <button
        type="button"
        onClick={onPress}
        aria-label={
          isActive
            ? `Edit set ${position}: ${primary}${secondary ? ` ${secondary}` : ''}${
                isWarmup ? ', warm-up' : ''
              }`
            : `Select ${exercise.name}`
        }
        className={`flex items-baseline gap-1 rounded-control px-2.5 py-1.5 font-mono tabular-nums transition-transform active:scale-95 ${background} ${
          isWarmup ? 'text-muted' : 'text-ink'
        } ${justLogged ? 'animate-set-logged' : ''}`}
      >
        <span className={isWarmup ? 'text-sm' : 'text-base font-semibold'}>{primary}</span>
        {secondary ? <span className="text-xs text-muted">{secondary}</span> : null}
      </button>
    </li>
  );
}
