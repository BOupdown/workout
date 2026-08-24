import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { buildSeedExercises } from '../lib/db/seed';
import { createExercise, listSelectableExercises } from '../lib/db/exercises';
import { checkExerciseShape } from '../lib/db/validation';
import type { Exercise } from '../lib/db/types';
import { CUSTOM_EXERCISE_NAME, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('the shipped catalogue', () => {
  it('holds no duplicate name', async () => {
    // `&nameKey` is unique: a duplicate would fail `on('populate')`, and so
    // make the app impossible to open on any new install. It is the one flaw
    // in this list that breaks everything at once.
    const keys = buildSeedExercises().map((exercise) => exercise.nameKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('holds none but valid rows', async () => {
    for (const exercise of buildSeedExercises()) {
      expect(checkExerciseShape(exercise)).toEqual([]);
    }
  });

  it('is delivered in full when the database is created', async () => {
    const shipped = buildSeedExercises();
    expect(await db.exercises.count()).toBe(shipped.length);
  });

  it('leaves free the name the tests use', async () => {
    // Otherwise every test creating a custom exercise fails at once, for a
    // reason unrelated to what it asserts — which is what happened the day
    // "Face pull" shipped.
    await expect(
      createExercise({ name: CUSTOM_EXERCISE_NAME, loadType: 'external', metric: 'reps' }),
    ).resolves.toBeDefined();
  });

  it('is not so long that it can no longer be scanned', async () => {
    // A bound, not a magic number: a picker nobody can skim costs a search
    // every session, where a missing exercise costs ten seconds once.
    expect((await listSelectableExercises()).length).toBeLessThanOrEqual(80);
  });
});

/**
 * The v5 → v6 upgrade, exercised against a database that predates the
 * additions — the only shape where it does anything at all.
 */
describe('catalogue additions reach an existing database', () => {
  /** Rebuilds a database holding only the first few shipped exercises. */
  async function upgradeFrom(exercises: Exercise[]) {
    db.close();
    await Dexie.delete('workout');

    const legacy = new Dexie('workout');
    legacy.version(1).stores({
      exercises: 'id, &nameKey, name, muscleGroup, archivedAt',
      sessions: 'id, startedAt, date',
      sessionExercises: 'id, sessionId, exerciseId, [sessionId+order]',
      sets: 'id, sessionId, sessionExerciseId, [sessionExerciseId+order], [exerciseId+performedAt+order]',
    });
    legacy.version(2).stores({});
    legacy.version(3).stores({ bodyweights: 'date' });
    legacy.version(4).stores({ trainingBlocks: 'id, startsOn' });
    legacy.version(5).stores({});

    await legacy.open();
    await legacy.table('exercises').bulkAdd(exercises);
    legacy.close();

    await db.open();
  }

  it('adds what is missing', async () => {
    const shipped = buildSeedExercises();
    await upgradeFrom(shipped.slice(0, 5));

    expect(await db.exercises.count()).toBe(shipped.length);
  });

  it('does not duplicate what is already there', async () => {
    const shipped = buildSeedExercises();
    await upgradeFrom(shipped);

    expect(await db.exercises.count()).toBe(shipped.length);
  });

  it('leaves alone an exercise the user created under the same name', async () => {
    // `&nameKey` is unique: overwriting would lose their history and abort the
    // migration. It is skipped, and they keep theirs.
    const shipped = buildSeedExercises();
    const mine: Exercise = {
      ...shipped.find((e) => e.name === 'Front squat')!,
      id: 'mine',
      isCustom: true,
      defaultIncrementKg: 1.25,
    };

    await upgradeFrom([mine]);

    const stored = await db.exercises.where('nameKey').equals(mine.nameKey).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('mine');
    expect(stored[0].isCustom).toBe(true);
    expect(stored[0].defaultIncrementKg).toBe(1.25);
  });

  it('preserves the history attached to the exercises already there', async () => {
    const shipped = buildSeedExercises();
    const kept = shipped.slice(0, 3);
    await upgradeFrom(kept);

    for (const exercise of kept) {
      expect(await db.exercises.get(exercise.id)).toBeDefined();
    }
  });
});
