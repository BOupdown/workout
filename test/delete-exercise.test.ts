import { beforeEach, describe, expect, it } from 'vitest';
import { addMissingSeedExercises, db } from '../lib/db/db';
import {
  createExercise,
  deleteExercise,
  ExerciseHasHistoryError,
  listSelectableExercises,
} from '../lib/db/exercises';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise } from '../lib/db/types';
import { CUSTOM_EXERCISE_NAME, exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;
let cycling: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
  cycling = await exerciseByKey('cycling');
});

describe('deleting an exercise from the catalogue', () => {
  it('takes it out of the picker for good', async () => {
    // Archiving hides it; here it no longer exists.
    await deleteExercise(cycling.id);

    const offered = await listSelectableExercises();
    expect(offered.some((exercise) => exercise.id === cycling.id)).toBe(false);
    expect(await db.exercises.get(cycling.id)).toBeUndefined();
    expect(await db.exercises.where('archivedAt').above(0).count()).toBe(0);
  });

  it('works on a hand-made exercise too', async () => {
    const mine = await createExercise({
      name: CUSTOM_EXERCISE_NAME,
      loadType: 'external',
      metric: 'reps',
    });

    await deleteExercise(mine.id);

    expect(await db.exercises.get(mine.id)).toBeUndefined();
  });

  it('refuses as soon as one set exists, erasing nothing', async () => {
    // A `SetEntry` points at its exercise: deleting it would erase training.
    // This is the case where archiving is the right answer.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });

    await expect(deleteExercise(squat.id)).rejects.toBeInstanceOf(ExerciseHasHistoryError);

    expect(await db.exercises.get(squat.id)).toBeDefined();
    expect(await db.sets.count()).toBe(1);
  });

  it('refuses even for a warm-up set', async () => {
    // A warm-up is kept out of the curves and the records, but it is training
    // all the same: the rule is "a set exists", not "a set that counts".
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 40, reps: 8, kind: 'warmup' });

    await expect(deleteExercise(squat.id)).rejects.toBeInstanceOf(ExerciseHasHistoryError);
  });

  it('says how many sets are in the way', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 4, kind: 'work' });

    await expect(deleteExercise(squat.id)).rejects.toMatchObject({ setCount: 2 });
  });

  it('takes a session block that stayed empty with it', async () => {
    // Added to a session and then never loaded: the block would point at a row
    // that is gone, and every read of the session would have to defend itself.
    const { session } = await startSession();
    await addExerciseToSession(session.id, cycling.id);

    await deleteExercise(cycling.id);

    expect(await db.sessionExercises.where('exerciseId').equals(cycling.id).count()).toBe(0);
  });

  it('frees the name', async () => {
    await deleteExercise(cycling.id);

    await expect(
      createExercise({ name: 'Cycling', loadType: 'bodyweight', metric: 'time' }),
    ).resolves.toBeDefined();
  });
});

/**
 * The property that makes deletion mean anything: every version that grows the
 * shipped catalogue runs the backfill, and it adds whatever name is free.
 * Without a tombstone it would hand back what the user removed.
 *
 * Tested through `addMissingSeedExercises` rather than through a migration:
 * the version that will next call it does not exist yet, and reopening the
 * database at the current version replays nothing — which is how the first
 * version of these tests passed with the guard deleted.
 */
describe('a deletion survives a catalogue update', () => {
  /** Replays the backfill the way a future schema version would. */
  const replayBackfill = () =>
    db.transaction('rw', db.exercises, db.retiredExercises, (transaction) =>
      addMissingSeedExercises(transaction),
    );

  it('does not hand back a deleted exercise', async () => {
    await deleteExercise(cycling.id);
    const after = await db.exercises.count();

    await replayBackfill();

    expect(await db.exercises.count()).toBe(after);
    expect(await db.exercises.where('nameKey').equals(cycling.nameKey).count()).toBe(0);
  });

  it('hands none of them back, across several deletions', async () => {
    const running = await exerciseByKey('running');
    await deleteExercise(cycling.id);
    await deleteExercise(running.id);

    await replayBackfill();

    expect(await db.exercises.where('nameKey').equals(cycling.nameKey).count()).toBe(0);
    expect(await db.exercises.where('nameKey').equals(running.nameKey).count()).toBe(0);
  });

  it('does add back what was never deleted', async () => {
    // The guard on the guard: if the backfill stopped adding anything at all,
    // the tests above would pass for the wrong reason.
    await db.exercises.delete(squat.id);

    await replayBackfill();

    expect(await db.exercises.where('nameKey').equals(squat.nameKey).count()).toBe(1);
  });

  it('does not duplicate what is already there', async () => {
    const before = await db.exercises.count();

    await replayBackfill();

    expect(await db.exercises.count()).toBe(before);
  });
});
