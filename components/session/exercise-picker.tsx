'use client';

import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listSelectableExercises } from '@/lib/db/exercises';
import { toNameKey } from '@/lib/db/keys';
import type { Id } from '@/lib/db/types';
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
 */
export function ExercisePicker({ onPick, onClose }: ExercisePickerProps) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const exercises = useLiveQuery(() => listSelectableExercises(), []);

  const needle = toNameKey(search);
  const matches = (exercises ?? []).filter((exercise) => exercise.nameKey.includes(needle));

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

      <ul className="flex-1 overflow-y-auto px-4 py-2">
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
        ) : (
          matches.map((exercise) => (
            <li key={exercise.id}>
              <button
                type="button"
                onClick={() => onPick(exercise.id)}
                className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-line/60 text-left transition-transform active:scale-[0.99]"
              >
                <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium text-ink">
                  {exercise.name}
                  {/* Said on the exercise, not only on its sets: this is where
                      you decide which one you are about to do, and a one-arm
                      row read exactly like any other until now. */}
                  {exercise.perSide ? (
                    <span className="font-normal text-muted"> · per side</span>
                  ) : null}
                </span>
                {exercise.muscleGroup ? (
                  <span className="shrink-0 text-xs text-muted">{exercise.muscleGroup}</span>
                ) : null}
              </button>
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
