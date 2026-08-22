'use client';

import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listSelectableExercises } from '@/lib/db/exercises';
import { toNameKey } from '@/lib/db/keys';
import type { Exercise, Id } from '@/lib/db/types';
import { groupByMuscle } from '@/lib/exercise-groups';
import { ExerciseFormSheet } from '@/components/exercises/exercise-form-sheet';

interface ExercisePickerProps {
  onPick: (exerciseId: Id) => void;
  onClose: () => void;
}

/**
 * Picking an exercise to add to the session.
 *
 * Search goes through `toNameKey`, the same normalisation as the unique index:
 * typing "bench" finds "Bench press".
 *
 * Browsing is grouped by muscle, searching is not. At 58 entries a single
 * alphabetical column stopped being a list and became a wall — but a query has
 * already narrowed things, and headings over two or three results are noise
 * between you and the name you are looking at.
 */
export function ExercisePicker({ onPick, onClose }: ExercisePickerProps) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const exercises = useLiveQuery(() => listSelectableExercises(), []);

  const searching = search.trim() !== '';
  const needle = toNameKey(search);
  const matches = (exercises ?? []).filter((exercise) => exercise.nameKey.includes(needle));
  const sections = searching ? [] : groupByMuscle(matches);

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <div className="relative flex-1">
          <MagnifyingGlass
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            autoComplete="off"
            placeholder="Search"
            aria-label="Search exercises"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-12 w-full rounded-control border border-line bg-surface pr-3 pl-9 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-12 shrink-0 rounded-control px-2 text-[0.9375rem] font-medium text-muted transition-transform active:scale-95"
        >
          Cancel
        </button>
      </div>

      {/* See the index screen: top padding here would strand the sticky
          headings below it. */}
      <ul className={`flex-1 overflow-y-auto px-4 pb-2 ${searching ? 'pt-2' : ''}`}>
        {exercises === undefined ? (
          <li className="space-y-2 py-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="h-10 rounded-control bg-line" />
            ))}
          </li>
        ) : matches.length === 0 ? (
          <li className="py-8 text-center">
            <p className="text-sm text-muted">
              No exercise matches “{search.trim()}”.
            </p>
            {/* The moment an exercise is missing is the moment you want to
                create it: the searched name goes straight into the form. */}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-control bg-accent px-4 text-sm font-semibold text-accent-ink transition-transform active:scale-95"
            >
              <Plus size={16} weight="bold" />
              Create “{search.trim()}”
            </button>
          </li>
        ) : searching ? (
          matches.map((exercise) => (
            <Row key={exercise.id} exercise={exercise} showGroup onPick={onPick} />
          ))
        ) : (
          sections.map((section) => (
            <li key={section.label}>
              {/* Sticky: on a section of a dozen rows the heading scrolls away
                  long before the section does, and the answer to "which muscle
                  am I looking at" should not be to scroll back up. */}
              <h3 className="sticky top-0 z-10 -mx-4 bg-surface px-4 pt-3.5 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {section.label}
              </h3>
              <ul>
                {section.exercises.map((exercise) => (
                  <Row key={exercise.id} exercise={exercise} onPick={onPick} />
                ))}
              </ul>
            </li>
          ))
        )}
        {exercises !== undefined && matches.length > 0 ? (
          <li className="py-3">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-panel border border-dashed border-line text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.99]"
            >
              <Plus size={18} weight="bold" />
              New exercise
            </button>
          </li>
        ) : null}
      </ul>

      {creating ? (
        <ExerciseFormSheet
          initialName={search.trim()}
          onCreated={(exercise) => {
            setCreating(false);
            onPick(exercise.id);
          }}
          onUseExisting={(existing) => {
            setCreating(false);
            onPick(existing.id);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * One exercise in the list.
 *
 * The muscle group only shows while searching: under a heading that already
 * says "Chest", repeating it on every row is a column of the same word.
 */
function Row({
  exercise,
  showGroup = false,
  onPick,
}: {
  exercise: Exercise;
  showGroup?: boolean;
  onPick: (exerciseId: Id) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(exercise.id)}
        className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-line/60 text-left transition-transform active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-ink">
          {exercise.name}
          {/* Said on the exercise, not only on its sets: this is where you
              decide which one you are about to do, and a one-arm row read
              exactly like any other until now. */}
          {exercise.perSide ? <span className="font-normal text-muted"> · per side</span> : null}
        </span>
        {showGroup && exercise.muscleGroup ? (
          <span className="shrink-0 text-xs text-muted">{exercise.muscleGroup}</span>
        ) : null}
      </button>
    </li>
  );
}
