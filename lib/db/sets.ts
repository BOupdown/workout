/**
 * Write layer for sets — the only entry point to create or edit a `SetEntry`.
 *
 * Two complementary strategies hold the invariants:
 *
 *   1. **Derive rather than validate.** `sessionId`, `exerciseId`, `performedAt`,
 *      `loggedAt` and `order` appear in no input type: they are recomputed from
 *      the parent block. A caller cannot desynchronise them, so there is
 *      nothing to check.
 *   2. **Validate what remains**, inside the transaction, against the parent
 *      `Exercise` — which the synchronous Dexie hooks cannot do.
 */

import { db } from './db';
import { newId } from './keys';
import type { Id, SetEntry, SetKind } from './types';
import { assertValidSet } from './validation';

/**
 * Bounds for the numeric components of a compound key.
 *
 * `Dexie.maxKey` is **not** used: it is a single shared array instance (`[[]]`),
 * and the IndexedDB spec's "convert a value to a key" algorithm shares its
 * `seen` set across the sibling elements of a compound key, rejecting any value
 * already encountered. Its cycle detection cannot tell a real cycle from a
 * repeated instance, so `[id, maxKey, maxKey]` throws a `DataError`. Since
 * `performedAt` and `order` are always numbers, ±Infinity is an exact and
 * trap-free bound.
 */
const MIN_NUMBER_KEY = -Infinity;
const MAX_NUMBER_KEY = Infinity;

/**
 * What a caller supplies to create a set. Everything else is derived — that is
 * the "made impossible" half of the invariants.
 */
export interface NewSetInput {
  sessionExerciseId: Id;
  /** Defaults to `'work'`. */
  kind?: SetKind;
  weightKg?: number;
  reps?: number;
  durationSec?: number;
  rpe?: number;
  isFailure?: boolean;
  notes?: string;
}

/**
 * Fields editable after the fact. The denormalised ones are deliberately
 * absent: removing them from the type is sturdier than refusing them at
 * runtime.
 *
 * A key present with `undefined` **clears** the field (the same semantics as
 * Dexie's `Table.update`); an absent key leaves it as is.
 */
export type SetPatch = Partial<
  Pick<SetEntry, 'kind' | 'weightKg' | 'reps' | 'durationSec' | 'rpe' | 'isFailure' | 'notes'>
>;

/** Drops `undefined` keys so they are never materialised in the database. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/**
 * Creates a set inside an existing block.
 *
 * @throws {SetValidationError} when the measures do not match the exercise
 *   (a load on a bodyweight movement, reps on a timed one…).
 * @throws {Error} when the block, session or exercise cannot be found.
 */
export async function createSet(input: NewSetInput): Promise<SetEntry> {
  return db.transaction(
    'rw',
    db.sets,
    db.sessionExercises,
    db.sessions,
    db.exercises,
    async () => {
      const block = await db.sessionExercises.get(input.sessionExerciseId);
      if (!block) {
        throw new Error(`Session exercise not found: ${input.sessionExerciseId}`);
      }

      const [session, exercise] = await Promise.all([
        db.sessions.get(block.sessionId),
        db.exercises.get(block.exerciseId),
      ]);
      if (!session) throw new Error(`Session not found: ${block.sessionId}`);
      if (!exercise) throw new Error(`Exercise not found: ${block.exerciseId}`);

      // `order` is strictly increasing, not necessarily contiguous: deleting a
      // set must not force renumbering the rest. The "Set 1, 2, 3" display uses
      // the array index, not this field.
      const last = await db.sets
        .where('[sessionExerciseId+order]')
        .between([block.id, MIN_NUMBER_KEY], [block.id, MAX_NUMBER_KEY])
        .reverse()
        .first();

      const entry: SetEntry = withoutUndefined({
        id: newId(),
        sessionExerciseId: block.id,

        // Denormalisations derived from the parents — never supplied by the caller.
        sessionId: block.sessionId,
        exerciseId: block.exerciseId,
        performedAt: session.startedAt,
        loggedAt: Date.now(),

        order: last ? last.order + 1 : 0,
        kind: input.kind ?? 'work',

        weightKg: input.weightKg,
        reps: input.reps,
        durationSec: input.durationSec,
        rpe: input.rpe,
        isFailure: input.isFailure,
        notes: input.notes,
      });

      assertValidSet(entry, exercise);
      await db.sets.add(entry);
      return entry;
    },
  );
}

/**
 * Edits an existing set. The resulting set is validated **before** writing: a
 * typo correction cannot leave the history inconsistent.
 *
 * @throws {SetValidationError} when the patched set would be invalid.
 */
export async function updateSet(id: Id, patch: SetPatch): Promise<SetEntry> {
  return db.transaction('rw', db.sets, db.exercises, async () => {
    const existing = await db.sets.get(id);
    if (!existing) throw new Error(`Set not found: ${id}`);

    const exercise = await db.exercises.get(existing.exerciseId);
    if (!exercise) throw new Error(`Exercise not found: ${existing.exerciseId}`);

    // Merge aligned with `Table.update`: a key present and `undefined` clears
    // the field, an absent key leaves it untouched.
    const next = { ...existing } as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      const value = patch[key as keyof SetPatch];
      if (value === undefined) delete next[key];
      else next[key] = value;
    }

    const merged = next as unknown as SetEntry;
    assertValidSet(merged, exercise);

    await db.sets.update(id, patch);
    return merged;
  });
}

/**
 * Since `order` stays strictly increasing and non-contiguous, a deletion has
 * nothing to renumber.
 */
export async function deleteSet(id: Id): Promise<void> {
  await db.sets.delete(id);
}

/**
 * How many sets were ever logged for an exercise, warm-ups included.
 *
 * There is **no** index on `exerciseId` alone: the compound
 * `[exerciseId+performedAt+order]` already covers it, and a range over its
 * first element is enough. One more index would be one more index to maintain
 * on every set write.
 */
export async function countSetsForExercise(exerciseId: Id): Promise<number> {
  return db.sets
    .where('[exerciseId+performedAt+order]')
    .between(
      [exerciseId, MIN_NUMBER_KEY, MIN_NUMBER_KEY],
      [exerciseId, MAX_NUMBER_KEY, MAX_NUMBER_KEY],
    )
    .count();
}

/**
 * "Show me my last N squat sets."
 *
 * As much a useful query as the justification for the
 * `[exerciseId+performedAt+order]` index: no join with `sessions`, and ordering
 * within a session stays exact thanks to `order` in third position.
 */
export async function recentSetsForExercise(
  exerciseId: Id,
  limit = 5,
  options: { includeWarmups?: boolean } = {},
): Promise<SetEntry[]> {
  const collection = db.sets
    .where('[exerciseId+performedAt+order]')
    .between(
      [exerciseId, MIN_NUMBER_KEY, MIN_NUMBER_KEY],
      [exerciseId, MAX_NUMBER_KEY, MAX_NUMBER_KEY],
    )
    .reverse();

  // `kind` is filtered in memory rather than through a dedicated index: the
  // tail walked is tiny, and it is one less index to maintain on every write.
  if (options.includeWarmups) return collection.limit(limit).toArray();

  return collection
    .filter((set) => set.kind === 'work')
    .limit(limit)
    .toArray();
}
