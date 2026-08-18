'use client';

import { CaretRight, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listSelectableExercises } from '@/lib/db/exercises';
import { toNameKey } from '@/lib/db/keys';
import { countSetsForExercise } from '@/lib/db/sets';
import type { Exercise } from '@/lib/db/types';
import { ExerciseFormSheet } from '@/components/exercises/exercise-form-sheet';
import { ProgressionSheet } from './progression-sheet';

/**
 * Point d'entrée de la progression hors séance.
 *
 * C'est ce qui manquait : la progression n'était atteignable que depuis une
 * séance en cours, alors qu'on la consulte surtout **avant** de s'entraîner.
 */
export function ExerciseIndexScreen() {
  const [search, setSearch] = useState('');
  const [openExercise, setOpenExercise] = useState<Exercise | null>(null);
  const [creating, setCreating] = useState(false);

  const exercises = useLiveQuery(() => listSelectableExercises(), []);

  // Un exercice jamais pratiqué n'a rien à montrer : on le range en fin de liste
  // plutôt que de le masquer, pour que le catalogue reste complet.
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

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[0.9375rem] font-semibold text-ink">Progression</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Créer un exercice"
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
            placeholder="Rechercher un exercice"
            aria-label="Rechercher un exercice"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-12 w-full rounded-control border border-line bg-surface pr-3 pl-9 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </div>
      </header>

      <ul className="flex-1 overflow-y-auto p-4">
        {exercises === undefined ? (
          <li className="space-y-2">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="h-14 rounded-panel bg-line" />
            ))}
          </li>
        ) : matches.length === 0 ? (
          <li className="py-10 text-center text-sm text-muted">
            Aucun exercice ne correspond à « {search.trim()} ».
          </li>
        ) : (
          matches.map((exercise) => {
            const setCount = counts?.get(exercise.id) ?? 0;
            return (
              <li key={exercise.id} className="mb-2">
                <button
                  type="button"
                  onClick={() => setOpenExercise(exercise)}
                  className="flex min-h-14 w-full items-center gap-3 rounded-panel bg-raised px-4 py-3 text-left transition-transform active:scale-[0.99]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-medium text-ink">
                      {exercise.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-muted tabular-nums">
                      {setCount > 0
                        ? `${setCount} série${setCount > 1 ? 's' : ''}`
                        : 'jamais pratiqué'}
                    </span>
                  </span>
                  <CaretRight size={16} className="shrink-0 text-muted" />
                </button>
              </li>
            );
          })
        )}
      </ul>

      {openExercise ? (
        <ProgressionSheet exercise={openExercise} onClose={() => setOpenExercise(null)} />
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
