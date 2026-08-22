'use client';

import { Archive, CaretRight, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listArchivedExercises, listSelectableExercises } from '@/lib/db/exercises';
import { toNameKey } from '@/lib/db/keys';
import { countSetsForExercise } from '@/lib/db/sets';
import type { Exercise } from '@/lib/db/types';
import { groupByMuscle } from '@/lib/exercise-groups';
import { ExerciseEditSheet } from '@/components/exercises/exercise-edit-sheet';
import { ExerciseFormSheet } from '@/components/exercises/exercise-form-sheet';
import { CalendarView } from './calendar-view';
import { ProgressionSheet } from './progression-sheet';

/**
 * The way into progression outside a session.
 *
 * This is what was missing: progression could only be reached from a session in
 * progress, whereas you mostly look at it **before** training.
 */
export function ExerciseIndexScreen() {
  const [view, setView] = useState<'exercises' | 'calendar'>('exercises');
  const [search, setSearch] = useState('');
  const [openExercise, setOpenExercise] = useState<Exercise | null>(null);
  const [editing, setEditing] = useState<Exercise | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = useLiveQuery(() => listSelectableExercises(), []);
  // Loaded unconditionally, because the count is what decides whether the
  // archive is worth mentioning at all.
  const archived = useLiveQuery(() => listArchivedExercises(), []);

  const exercises = showArchived ? archived : active;

  // An exercise never trained has nothing to show: it goes to the end of the
  // list rather than being hidden, so the catalogue stays complete.
  const counts = useLiveQuery(async () => {
    if (!exercises) return undefined;
    const entries = await Promise.all(
      exercises.map(async (exercise) => [exercise.id, await countSetsForExercise(exercise.id)] as const),
    );
    return new Map(entries);
  }, [exercises]);

  const needle = toNameKey(search);
  const matches = (exercises ?? [])
    .filter((exercise) => exercise.nameKey.includes(needle))
    .sort((a, b) => {
      const practised = Number((counts?.get(b.id) ?? 0) > 0) - Number((counts?.get(a.id) ?? 0) > 0);
      return practised !== 0 ? practised : a.name.localeCompare(b.name, 'fr');
    });

  /**
   * Sections when browsing the catalogue, `null` when the list should stay
   * flat.
   *
   * One axis only. Lifting the trained exercises into a section of their own
   * put a "have I done this" heading among "what does this work" ones, and took
   * the bench press out of Chest — so finding a chest exercise meant looking in
   * two places. They stay under their muscle.
   *
   * Trained-first survives inside each group at no cost: `matches` is already
   * sorted that way and `groupByMuscle` keeps the order it is given.
   *
   * Flat while searching, because a query has already narrowed things and
   * headings over two results get between the eye and the name. Flat in the
   * archive too, which holds a handful of rows and would come out as a column
   * of one-line sections.
   */
  const sections =
    search.trim() !== '' || showArchived ? null : groupByMuscle(matches);

  return (
    <div className="flex h-full flex-col">
      {/* Two subjects rather than one scroll: exercises are a per-movement
          question, the calendar a per-day one, and stacking them would make
          the second permanently below the fold. */}
      <div className="shrink-0 bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)]">
        <div className="flex gap-1.5" role="tablist" aria-label="Progress view">
          {(['exercises', 'calendar'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={`h-11 flex-1 rounded-control text-sm font-semibold capitalize transition-transform active:scale-[0.98] ${
                view === option ? 'bg-ink text-surface' : 'bg-surface text-muted'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {view === 'calendar' ? (
        <div className="min-h-0 flex-1">
          <CalendarView />
        </div>
      ) : (
      <>
      <header className="shrink-0 border-b border-line bg-raised px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[0.9375rem] font-semibold text-ink">Progress</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Create an exercise"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-accent text-accent-ink transition-transform active:scale-95"
          >
            <Plus size={18} weight="bold" />
          </button>
        </div>
        <div className="relative mt-2.5">
          <MagnifyingGlass
            size={18}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            autoComplete="off"
            placeholder="Search exercises"
            aria-label="Search exercises"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-12 w-full rounded-control border border-line bg-surface pr-3 pl-9 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </div>

        {(archived?.length ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => setShowArchived((shown) => !shown)}
            aria-pressed={showArchived}
            className={`mt-2 flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium transition-transform active:scale-[0.98] ${
              showArchived ? 'bg-ink text-surface' : 'text-muted'
            }`}
          >
            <Archive size={16} weight="bold" />
            {showArchived
              ? 'Back to the catalogue'
              : `Archived (${archived?.length ?? 0})`}
          </button>
        ) : null}
      </header>

      {/* No padding at the top of the scroll container. A sticky element cannot
          rise above its parent's content box, so container padding would freeze
          the headings below it and leave a strip where outgoing cards show
          through. The spacing moves inside instead. */}
      <ul className={`flex-1 overflow-y-auto px-4 pb-4 ${sections === null ? 'pt-4' : ''}`}>
        {exercises === undefined ? (
          <li className="space-y-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="h-14 rounded-panel bg-line" />
            ))}
          </li>
        ) : matches.length === 0 ? (
          <li className="py-10 text-center text-sm text-muted">
            {search.trim() === ''
              ? 'Nothing archived.'
              : `No exercise matches “${search.trim()}”.`}
          </li>
        ) : sections === null ? (
          matches.map((exercise) => (
            <Row
              key={exercise.id}
              exercise={exercise}
              setCount={counts?.get(exercise.id) ?? 0}
              onOpen={setOpenExercise}
            />
          ))
        ) : (
          sections.map((section) => (
            <li key={section.label}>
              {/* Sticky, like the picker: a section runs past a screenful long
                  before it ends, and scrolling back up to learn which muscle
                  you are reading is the problem this was meant to solve. */}
              <h3 className="sticky top-0 z-10 -mx-4 bg-surface px-4 pt-3.5 pb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {section.label}
              </h3>
              <ul>
                {section.exercises.map((exercise) => (
                  <Row
                    key={exercise.id}
                    exercise={exercise}
                    setCount={counts?.get(exercise.id) ?? 0}
                    onOpen={setOpenExercise}
                  />
                ))}
              </ul>
            </li>
          ))
        )}
      </ul>

      </>
      )}

      {openExercise ? (
        <ProgressionSheet
          exercise={openExercise}
          onEdit={() => setEditing(openExercise)}
          onClose={() => setOpenExercise(null)}
        />
      ) : null}

      {editing ? (
        <ExerciseEditSheet
          exercise={editing}
          onSaved={(saved) => {
            // Both sheets held a copy of the old row: refresh the one still
            // open underneath, so closing the editor does not reveal the name
            // that was just corrected.
            setOpenExercise((current) => (current?.id === saved.id ? saved : current));
            setEditing(null);
          }}
          onDeleted={() => {
            // The progression sheet underneath still holds the deleted row.
            setOpenExercise(null);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {creating ? (
        <ExerciseFormSheet
          onCreated={() => setCreating(false)}
          onUseExisting={(existing) => {
            setCreating(false);
            setOpenExercise(existing);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/** One exercise in the index, with what it has behind it. */
function Row({
  exercise,
  setCount,
  onOpen,
}: {
  exercise: Exercise;
  setCount: number;
  onOpen: (exercise: Exercise) => void;
}) {
  return (
    <li className="mb-2">
      <button
        type="button"
        onClick={() => onOpen(exercise)}
        className="flex min-h-14 w-full items-center gap-3 rounded-panel bg-raised px-4 py-3 text-left transition-transform active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-medium text-ink">
            {exercise.name}
            {exercise.perSide ? <span className="font-normal text-muted"> · per side</span> : null}
          </span>
          <span className="mt-0.5 block font-mono text-xs text-muted tabular-nums">
            {setCount > 0 ? `${setCount} set${setCount > 1 ? 's' : ''}` : 'never trained'}
          </span>
        </span>
        <CaretRight size={16} className="shrink-0 text-muted" />
      </button>
    </li>
  );
}
