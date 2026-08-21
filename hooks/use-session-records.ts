'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { recentSetsForExercise } from '@/lib/db/sets';
import { recordSet } from '@/lib/progression';
import type { Id, SessionExerciseWithSets } from '@/lib/db/types';

/** Same bound as the progression curve: past this, nothing on screen changes. */
const MAX_SETS = 200;

/**
 * Which set holds the record, for each exercise of the session.
 *
 * Derived rather than announced. A "you beat your record" message would have to
 * be raised at the moment of the write, compared against a value captured just
 * before it, and then held somewhere — three chances to be wrong. Marking *the
 * set that holds the record* needs none of that: correct a load, delete a set,
 * and the mark moves on its own, because it was never a fact about an event.
 *
 * One query per distinct exercise, over the `[exerciseId+performedAt+order]`
 * index. A session holds a handful, and the index is exactly what this reads.
 */
export function useSessionRecords(entries: SessionExerciseWithSets[]): Set<Id> {
  // Recomputed when the sets change, not merely when the list identity does:
  // logging a set has to be able to take the record.
  const signature = entries
    .map((entry) => `${entry.exercise.id}:${entry.sets.length}`)
    .join('|');

  const records = useLiveQuery(async () => {
    const byExercise = new Map(entries.map((entry) => [entry.exercise.id, entry.exercise]));

    const found = await Promise.all(
      [...byExercise.values()].map(async (exercise) => {
        const sets = await recentSetsForExercise(exercise.id, MAX_SETS);
        return recordSet(sets, exercise)?.id;
      }),
    );

    return new Set(found.filter((id): id is Id => id !== undefined));
  }, [signature]);

  return records ?? new Set<Id>();
}
