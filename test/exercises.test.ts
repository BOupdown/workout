import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import {
  archiveExercise,
  createExercise,
  ExerciseInUseError,
  ExerciseNameConflictError,
  findExerciseByName,
  listArchivedExercises,
  listSelectableExercises,
  unarchiveExercise,
  updateExercise,
} from '../lib/db/exercises';
import { createSet, recentSetsForExercise } from '../lib/db/sets';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import {
  ExerciseValidationError,
  SessionExerciseValidationError,
} from '../lib/db/validation';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps } = await referenceExercises());
});

describe('createExercise', () => {
  it('derives id, nameKey, isCustom and createdAt', async () => {
    const before = Date.now();
    const exercise = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });

    expect(exercise.id).toBeTruthy();
    expect(exercise.nameKey).toBe('sandbag carry');
    expect(exercise.isCustom).toBe(true);
    expect(exercise.createdAt).toBeGreaterThanOrEqual(before);
    expect(exercise.archivedAt).toBeUndefined();
  });

  it('defaults perSide to false', async () => {
    const exercise = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });
    expect(exercise.perSide).toBe(false);
  });

  it('does not materialise the optional fields that are absent', async () => {
    const exercise = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });

    expect('muscleGroup' in exercise).toBe(false);
    expect('notes' in exercise).toBe(false);
    expect('defaultIncrementKg' in exercise).toBe(false);
  });

  it('persists the exercise and makes it pickable', async () => {
    const exercise = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
      muscleGroup: 'shoulders',
      defaultIncrementKg: 1,
    });

    expect(await db.exercises.get(exercise.id)).toEqual(exercise);
    const selectable = await listSelectableExercises();
    expect(selectable.map((e) => e.id)).toContain(exercise.id);
  });

  it('accepts an exercise that is bodyweight and timed', async () => {
    const exercise = await createExercise({
      name: 'Chaise contre le mur',
      loadType: 'bodyweight',
      metric: 'time',
      muscleGroup: 'quads',
    });

    expect(exercise.loadType).toBe('bodyweight');
    expect(exercise.metric).toBe('time');
  });
});

describe('createExercise — conflit de nom', () => {
  it('refuses a name already taken, up to normalisation', async () => {
    await expect(
      createExercise({ name: 'SQUAT', loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseNameConflictError);
  });

  it('refuses an accented or punctuated variant too', async () => {
    await createExercise({ name: 'Sandbag carry', loadType: 'external', metric: 'reps' });

    await expect(
      createExercise({ name: 'sandbag-carry !', loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseNameConflictError);
  });

  it('carries the existing exercise, so the UI can offer it', async () => {
    await createExercise({ name: 'Squat', loadType: 'bodyweight', metric: 'time' }).then(
      () => expect.unreachable('the creation should have been refused'),
      (err: ExerciseNameConflictError) => {
        expect(err.existing.id).toBe(squat.id);
        // The point of the decision: the existing one is never returned
        // silently, its loadType not being the one that was asked for.
        expect(err.existing.loadType).toBe('external');
        expect(err.existing.metric).toBe('reps');
      },
    );
  });

  it('reports that a namesake is archived', async () => {
    const custom = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });
    await archiveExercise(custom.id);

    await createExercise({ name: 'Sandbag carry', loadType: 'external', metric: 'reps' }).then(
      () => expect.unreachable('the creation should have been refused'),
      (err: ExerciseNameConflictError) => {
        expect(err.existing.archivedAt).toBeDefined();
        expect(err.message).toContain('archived');
      },
    );
  });

  it('writes nothing when the name is refused', async () => {
    const before = await db.exercises.count();
    await createExercise({ name: 'SQUAT', loadType: 'external', metric: 'reps' }).catch(() => {});

    expect(await db.exercises.count()).toBe(before);
  });
});

describe('findExerciseByName', () => {
  it('finds an exercise, up to normalisation', async () => {
    expect((await findExerciseByName('  SQUAT  '))?.id).toBe(squat.id);
  });

  it('returns nothing for a name that is free', async () => {
    expect(await findExerciseByName('Mouvement inexistant')).toBeUndefined();
  });
});

describe('structural validation', () => {
  it('refuses an empty name', async () => {
    await expect(
      createExercise({ name: '   ', loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuses a name that is too long', async () => {
    await expect(
      createExercise({ name: 'x'.repeat(81), loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuses an unknown muscle group', async () => {
    await expect(
      createExercise({
        name: 'Sandbag carry',
        loadType: 'external',
        metric: 'reps',
        muscleGroup: 'tentacles' as Exercise['muscleGroup'],
      }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuses an increment on a bodyweight exercise', async () => {
    await expect(
      createExercise({
        name: 'Wall sit against the door',
        loadType: 'bodyweight',
        metric: 'time',
        defaultIncrementKg: 2.5,
      }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuses a direct add() whose nameKey does not derive from name', async () => {
    // Without this invariant, an inconsistent pair would slip past the unique
    // `&nameKey` index and fragment the history of one movement.
    await expect(
      db.exercises.add({
        id: 'incoherent',
        name: 'Bench press',
        nameKey: 'something else',
        loadType: 'external',
        metric: 'reps',
        perSide: false,
        isCustom: true,
        createdAt: Date.now(),
      }),
    ).rejects.toThrow(ExerciseValidationError);
  });
});

describe('updateExercise — champs libres', () => {
  it('renames and re-derives nameKey', async () => {
    const updated = await updateExercise(squat.id, { name: 'Squat barre haute' });

    expect(updated.name).toBe('Squat barre haute');
    expect(updated.nameKey).toBe('squat barre haute');
    expect((await db.exercises.get(squat.id))!.nameKey).toBe('squat barre haute');
  });

  it('frees the old name after a rename', async () => {
    await updateExercise(squat.id, { name: 'Squat barre haute' });

    const recreated = await createExercise({
      name: 'Squat',
      loadType: 'external',
      metric: 'reps',
    });
    expect(recreated.nameKey).toBe('squat');
  });

  it('refuses a rename onto a name already taken', async () => {
    await expect(updateExercise(squat.id, { name: 'Push-ups' })).rejects.toThrow(
      ExerciseNameConflictError,
    );
    expect((await db.exercises.get(squat.id))!.name).toBe('Squat');
  });

  it('accepts a cosmetic rename that leaves nameKey alone', async () => {
    const updated = await updateExercise(squat.id, { name: 'SQUAT' });
    expect(updated.name).toBe('SQUAT');
    expect(updated.nameKey).toBe('squat');
  });

  it('edits muscle group, increment and notes', async () => {
    const updated = await updateExercise(squat.id, {
      muscleGroup: 'glutes',
      defaultIncrementKg: 5,
      notes: 'ceinture',
    });

    expect(updated.muscleGroup).toBe('glutes');
    expect(updated.defaultIncrementKg).toBe(5);
    expect(updated.notes).toBe('ceinture');
  });

  it('clears an optional field handed undefined', async () => {
    const updated = await updateExercise(squat.id, { defaultIncrementKg: undefined });

    expect(updated.defaultIncrementKg).toBeUndefined();
    expect((await db.exercises.get(squat.id))!.defaultIncrementKg).toBeUndefined();
  });

  it('leaves untouched the keys the patch does not carry', async () => {
    const updated = await updateExercise(squat.id, { notes: 'test' });

    expect(updated.name).toBe('Squat');
    expect(updated.loadType).toBe('external');
    expect(updated.defaultIncrementKg).toBe(squat.defaultIncrementKg);
  });

  it('throws for an exercise it does not know', async () => {
    await expect(updateExercise('inconnu', { notes: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('updateExercise — nature locked by the history', () => {
  /** Logs one squat set, so the exercise counts as "in use". */
  async function logOneSquatSet() {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
  }

  it('allows the nature to change while no set exists', async () => {
    const updated = await updateExercise(squat.id, { loadType: 'bodyweight', metric: 'time' });

    expect(updated.loadType).toBe('bodyweight');
    expect(updated.metric).toBe('time');
  });

  it('clears the increment when switching to bodyweight', async () => {
    // The catalogue gives the squat a 2.5 kg step; once it is bodyweight, that
    // step means nothing. A derived consequence, not an error to report.
    expect(squat.defaultIncrementKg).toBe(2.5);
    const updated = await updateExercise(squat.id, { loadType: 'bodyweight' });

    expect(updated.defaultIncrementKg).toBeUndefined();
    expect('defaultIncrementKg' in (await db.exercises.get(squat.id))!).toBe(false);
  });

  it('keeps the increment for the other loadTypes', async () => {
    const updated = await updateExercise(squat.id, { loadType: 'weighted_bodyweight' });
    expect(updated.defaultIncrementKg).toBe(2.5);
  });

  it.each(['loadType', 'metric', 'perSide'] as const)(
    'refuses to change %s once a set exists',
    async (field) => {
      await logOneSquatSet();

      const patch = {
        loadType: { loadType: 'bodyweight' as const },
        metric: { metric: 'time' as const },
        perSide: { perSide: true },
      }[field];

      await expect(updateExercise(squat.id, patch)).rejects.toThrow(ExerciseInUseError);
    },
  );

  it('carries the number of sets and the locked fields', async () => {
    await logOneSquatSet();
    await logOneSquatSet();

    await updateExercise(squat.id, { loadType: 'bodyweight', perSide: true }).then(
      () => expect.unreachable('the edit should have been refused'),
      (err: ExerciseInUseError) => {
        expect(err.setCount).toBe(2);
        expect(err.lockedFields).toEqual(['loadType', 'perSide']);
        expect(err.message).toContain('Archive it');
      },
    );
  });

  it('counts the warm-ups too', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, kind: 'warmup', weightKg: 40, reps: 10 });

    await expect(updateExercise(squat.id, { metric: 'time' })).rejects.toThrow(
      ExerciseInUseError,
    );
  });

  it('treats sending the current value back as a no-op', async () => {
    await logOneSquatSet();

    // The UI often sends the whole form back: rewriting the unchanged value of
    // a locked field must not be an error.
    const updated = await updateExercise(squat.id, {
      loadType: 'external',
      metric: 'reps',
      perSide: false,
      notes: 'barre haute',
    });

    expect(updated.notes).toBe('barre haute');
  });

  it('leaves the free fields editable on an exercise in use', async () => {
    await logOneSquatSet();
    const updated = await updateExercise(squat.id, { name: 'Squat barre haute' });

    expect(updated.name).toBe('Squat barre haute');
  });

  it('writes nothing when the edit is refused', async () => {
    await logOneSquatSet();
    await updateExercise(squat.id, { loadType: 'bodyweight', notes: 'perdu' }).catch(() => {});

    const reloaded = (await db.exercises.get(squat.id))!;
    expect(reloaded.loadType).toBe('external');
    expect(reloaded.notes).toBeUndefined();
  });
});

describe('archivage', () => {
  it('takes the exercise out of the picker', async () => {
    await archiveExercise(squat.id);

    const selectable = await listSelectableExercises();
    expect(selectable.map((e) => e.id)).not.toContain(squat.id);
  });

  it('makes it appear in the archive', async () => {
    await archiveExercise(squat.id);

    const archived = await listArchivedExercises();
    expect(archived.map((e) => e.id)).toEqual([squat.id]);
  });

  it('est idempotent', async () => {
    const first = await archiveExercise(squat.id);
    const second = await archiveExercise(squat.id);

    expect(second.archivedAt).toBe(first.archivedAt);
  });

  it('prevents it being added to a new session', async () => {
    await archiveExercise(squat.id);
    const { session } = await startSession();

    await expect(addExerciseToSession(session.id, squat.id)).rejects.toThrow(
      SessionExerciseValidationError,
    );
  });

  it('throws for an exercise it does not know', async () => {
    await expect(archiveExercise('inconnu')).rejects.toThrow(/not found/);
  });
});

describe('archivage — l’historique reste intact', () => {
  it('keeps the sets already recorded', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await archiveExercise(squat.id);

    expect(await recentSetsForExercise(squat.id, 10)).toHaveLength(2);
    expect(await db.sessionExercises.get(block.id)).toBeDefined();
  });

  it('lets a running session that already holds the exercise finish', async () => {
    // A deliberate asymmetry: archiving blocks adding a *new* block, but not
    // logging into one already open. A session in progress is not interrupted.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await archiveExercise(squat.id);

    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    expect(set.order).toBe(1);
  });
});

describe('unarchiving', () => {
  it('puts the exercise back in the picker', async () => {
    await archiveExercise(squat.id);
    const restored = await unarchiveExercise(squat.id);

    expect(restored.archivedAt).toBeUndefined();
    expect((await listSelectableExercises()).map((e) => e.id)).toContain(squat.id);
    expect(await listArchivedExercises()).toHaveLength(0);
  });

  it('really removes the property rather than setting it to undefined', async () => {
    await archiveExercise(squat.id);
    await unarchiveExercise(squat.id);

    const reloaded = (await db.exercises.get(squat.id))!;
    expect('archivedAt' in reloaded).toBe(false);
  });

  it('is idempotent on an exercise that is not archived', async () => {
    const untouched = await unarchiveExercise(pushUps.id);
    expect(untouched.archivedAt).toBeUndefined();
  });

  it('allows it to be added to a session again', async () => {
    await archiveExercise(squat.id);
    await unarchiveExercise(squat.id);

    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    expect(block.exerciseId).toBe(squat.id);
  });
});
