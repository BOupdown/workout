/**
 * Write layer for the exercise catalogue.
 *
 * Same doctrine as `./sets` and `./sessions`:
 *   1. **Derive rather than validate** — `id`, `nameKey`, `isCustom`,
 *      `createdAt` and `archivedAt` appear in no input type.
 *   2. **Validate what remains** inside the transaction: uniqueness of the
 *      normalised name, and whether sets already exist — two rules that need a
 *      read and are therefore out of reach of the synchronous Dexie hooks.
 *
 * There is deliberately no hard delete: removing an exercise would orphan every
 * `SetEntry.exerciseId` in the history, and a cascade would destroy years of
 * data from a settings screen. Archiving covers the real need (decluttering the
 * picker) without losing anything.
 */

import { db } from './db';
import { newId, toNameKey } from './keys';
import { countSetsForExercise } from './sets';
import type {
  EffortMetric,
  Exercise,
  Id,
  LoadType,
  MuscleGroup,
  Timestamp,
} from './types';

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the normalised name is already taken.
 *
 * Carries the existing exercise: the UI can offer "Bench press already exists —
 * use it?" in one tap, with no second round trip. Its `existing.archivedAt`
 * field tells the UI whether to offer unarchiving instead.
 *
 * The existing exercise is **never** returned silently in place of the new one:
 * its `loadType` and `metric` are not the ones requested, and the caller would
 * have no way to notice.
 */
export class ExerciseNameConflictError extends Error {
  readonly existing: Exercise;

  constructor(existing: Exercise) {
    const state = existing.archivedAt !== undefined ? ' (archived)' : '';
    super(`An exercise named "${existing.name}" already exists${state}.`);
    this.name = 'ExerciseNameConflictError';
    this.existing = existing;
  }
}

/**
 * Thrown when changing the nature of an exercise that is already in use.
 *
 * Deliberately without a `force` escape hatch: switching an exercise from
 * `weighted_bodyweight` to `bodyweight` would invalidate every set already
 * logged, and would distort progression by comparing weighted pull-ups to
 * bodyweight ones. The right move is to archive the old one and create a new
 * one — a different movement deserves a different identity.
 */
/**
 * Deleting an exercise that has been trained.
 *
 * Refused rather than cascaded: a `SetEntry` points at its exercise, so
 * removing the row would take real sessions with it. Archiving already covers
 * "I don't do this any more" without losing anything.
 */
export class ExerciseHasHistoryError extends Error {
  readonly exerciseId: Id;
  readonly setCount: number;

  constructor(exerciseId: Id, setCount: number) {
    super(
      `This exercise has ${setCount} set${setCount > 1 ? 's' : ''} recorded: ` +
        'archive it instead of deleting it.',
    );
    this.name = 'ExerciseHasHistoryError';
    this.exerciseId = exerciseId;
    this.setCount = setCount;
  }
}

export class ExerciseInUseError extends Error {
  readonly exerciseId: Id;
  readonly setCount: number;
  readonly lockedFields: readonly string[];

  constructor(exerciseId: Id, setCount: number, lockedFields: readonly string[]) {
    super(
      `This exercise has ${setCount} set${setCount > 1 ? 's' : ''}: ` +
        `${lockedFields.join(', ')} can no longer be changed. ` +
        'Archive it and create a new one.',
    );
    this.name = 'ExerciseInUseError';
    this.exerciseId = exerciseId;
    this.setCount = setCount;
    this.lockedFields = lockedFields;
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface NewExerciseInput {
  name: string;
  loadType: LoadType;
  metric: EffortMetric;
  /** Reps counted per side. Defaults to `false`. */
  perSide?: boolean;
  muscleGroup?: MuscleGroup;
  defaultIncrementKg?: number;
  notes?: string;
}

/**
 * Editable fields. `archivedAt` is absent — archiving has its own functions;
 * so are `isCustom`, `id`, `nameKey` and `createdAt`, which are derived.
 *
 * A key present with `undefined` clears the field, an absent key leaves it as
 * is — the same semantics as `Table.update`.
 */
export type ExerciseUpdate = Partial<
  Pick<
    Exercise,
    'name' | 'loadType' | 'metric' | 'perSide' | 'muscleGroup' | 'defaultIncrementKg' | 'notes'
  >
>;

/**
 * Fields that redefine the **nature** of an exercise, and therefore the meaning
 * of the sets already recorded. Locked as soon as one set exists.
 *
 * `perSide` belongs here even though it breaks no validation: switching it from
 * `false` to `true` silently rewrites what past reps meant ("10" becomes 10 per
 * arm). Same damage, less visible.
 */
const NATURE_FIELDS = ['loadType', 'metric', 'perSide'] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Finds an exercise by name, up to normalisation. */
export async function findExerciseByName(name: string): Promise<Exercise | undefined> {
  return db.exercises.where('nameKey').equals(toNameKey(name)).first();
}

/** Exercises offerable in the picker: everything but the archived, A to Z. */
export async function listSelectableExercises(): Promise<Exercise[]> {
  return db.exercises
    .orderBy('name')
    .filter((exercise) => exercise.archivedAt === undefined)
    .toArray();
}

/**
 * Archived exercises.
 *
 * Since `undefined` is never indexed, the `archivedAt` index contains *only*
 * archived rows: the range is enough, with no in-memory filter.
 */
export async function listArchivedExercises(): Promise<Exercise[]> {
  return db.exercises.where('archivedAt').above(0).sortBy('name');
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Creates a custom exercise.
 *
 * @throws {ExerciseNameConflictError} when the normalised name is taken.
 */
export async function createExercise(input: NewExerciseInput): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const nameKey = toNameKey(input.name);

    // The check and the insert share the transaction: IndexedDB serialises
    // operations on a single store, so there is no window between them. The
    // `&nameKey` index remains the ultimate guard; this check exists only to
    // produce a usable error rather than an opaque `ConstraintError`.
    const existing = await db.exercises.where('nameKey').equals(nameKey).first();
    if (existing) throw new ExerciseNameConflictError(existing);

    const exercise: Exercise = {
      id: newId(),
      name: input.name,
      nameKey,
      loadType: input.loadType,
      metric: input.metric,
      perSide: input.perSide ?? false,
      isCustom: true,
      createdAt: Date.now(),
      ...(input.muscleGroup !== undefined ? { muscleGroup: input.muscleGroup } : {}),
      ...(input.defaultIncrementKg !== undefined
        ? { defaultIncrementKg: input.defaultIncrementKg }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };

    await db.exercises.add(exercise);
    return exercise;
  });
}

/**
 * Edits an exercise. `nameKey` is re-derived whenever `name` changes.
 *
 * @throws {ExerciseNameConflictError} when the new name is already taken.
 * @throws {ExerciseInUseError} when the exercise's nature changes while sets
 *   already exist.
 */
export async function updateExercise(id: Id, patch: ExerciseUpdate): Promise<Exercise> {
  return db.transaction('rw', db.exercises, db.sets, async () => {
    const existing = await db.exercises.get(id);
    if (!existing) throw new Error(`Exercise not found: ${id}`);

    // Only *effective* changes count: sending back a locked field's current
    // value must stay a no-op, not an error.
    const changedNature = NATURE_FIELDS.filter(
      (field) => field in patch && patch[field] !== existing[field],
    );

    if (changedNature.length > 0) {
      const setCount = await countSetsForExercise(id);
      if (setCount > 0) throw new ExerciseInUseError(id, setCount, changedNature);
    }

    const changes: ExerciseUpdate & { nameKey?: string } = { ...patch };

    if (patch.name !== undefined) {
      const nameKey = toNameKey(patch.name);
      if (nameKey !== existing.nameKey) {
        const conflict = await db.exercises.where('nameKey').equals(nameKey).first();
        if (conflict) throw new ExerciseNameConflictError(conflict);
      }
      changes.nameKey = nameKey;
    }

    // A derived consequence, not an error to report: a bodyweight exercise has
    // no load field, so no progression step. Requiring the caller to clear it
    // themselves would only produce a baffling rejection — and the cleared
    // value has, by definition, stopped meaning anything.
    const nextLoadType = patch.loadType ?? existing.loadType;
    if (nextLoadType === 'bodyweight' && !('defaultIncrementKg' in changes)) {
      changes.defaultIncrementKg = undefined;
    }

    // Merge aligned with `Table.update`: a key present and `undefined` clears it.
    const next = { ...existing } as Record<string, unknown>;
    for (const key of Object.keys(changes)) {
      const value = changes[key as keyof typeof changes];
      if (value === undefined) delete next[key];
      else next[key] = value;
    }

    await db.exercises.update(id, changes);
    return next as unknown as Exercise;
  });
}

/**
 * Archives an exercise: it leaves the picker, **the history stays intact**. No
 * `SetEntry` is touched and past progression remains readable.
 *
 * Idempotent: re-archiving an archived exercise returns it unchanged.
 */
export async function archiveExercise(
  id: Id,
  archivedAt: Timestamp = Date.now(),
): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const exercise = await db.exercises.get(id);
    if (!exercise) throw new Error(`Exercise not found: ${id}`);
    if (exercise.archivedAt !== undefined) return exercise;

    await db.exercises.update(id, { archivedAt });
    return { ...exercise, archivedAt };
  });
}

/**
 * Deletes an exercise that was never trained.
 *
 * The catalogue ships wide so nobody has to create a bench press by hand, and
 * the cost of that is a picker holding movements a given person will never do.
 * Archiving hides them; this removes them.
 *
 * Only ever the untrained ones. With a single set recorded, deleting would be
 * deleting training, and `archiveExercise` is the right gesture instead — it
 * clears the picker just as well and keeps the history readable.
 *
 * A tombstone is written so the catalogue backfill does not hand it straight
 * back the next time the shipped list grows.
 *
 * @throws {ExerciseHasHistoryError} when any set references it.
 */
export async function deleteExercise(
  id: Id,
  retiredAt: Timestamp = Date.now(),
): Promise<void> {
  await db.transaction(
    'rw',
    db.exercises,
    db.sets,
    db.sessionExercises,
    db.retiredExercises,
    async () => {
      const exercise = await db.exercises.get(id);
      if (!exercise) throw new Error(`Exercise not found: ${id}`);

      const setCount = await countSetsForExercise(id);
      if (setCount > 0) throw new ExerciseHasHistoryError(id, setCount);

      // An exercise can sit in a session with nothing logged under it — added,
      // then the session ended. Those blocks would otherwise point at a row
      // that no longer exists.
      await db.sessionExercises.where('exerciseId').equals(id).delete();

      await db.exercises.delete(id);
      await db.retiredExercises.put({ nameKey: exercise.nameKey, retiredAt });
    },
  );
}

/** Puts an exercise back in the picker. Idempotent. */
export async function unarchiveExercise(id: Id): Promise<Exercise> {
  return db.transaction('rw', db.exercises, async () => {
    const exercise = await db.exercises.get(id);
    if (!exercise) throw new Error(`Exercise not found: ${id}`);
    if (exercise.archivedAt === undefined) return exercise;

    // `undefined` deletes the property, so the row leaves the `archivedAt`
    // index — which is what makes it reappear in the picker.
    await db.exercises.update(id, { archivedAt: undefined });

    const unarchived = { ...exercise };
    delete unarchived.archivedAt;
    return unarchived;
  });
}
