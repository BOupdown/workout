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

describe('supprimer un exercice du catalogue', () => {
  it('le retire du sélecteur pour de bon', async () => {
    // L'archivage le masque ; ici il n'existe plus.
    await deleteExercise(cycling.id);

    const offered = await listSelectableExercises();
    expect(offered.some((exercise) => exercise.id === cycling.id)).toBe(false);
    expect(await db.exercises.get(cycling.id)).toBeUndefined();
    expect(await db.exercises.where('archivedAt').above(0).count()).toBe(0);
  });

  it('marche aussi sur un exercice créé à la main', async () => {
    const mine = await createExercise({
      name: CUSTOM_EXERCISE_NAME,
      loadType: 'external',
      metric: 'reps',
    });

    await deleteExercise(mine.id);

    expect(await db.exercises.get(mine.id)).toBeUndefined();
  });

  it('refuse dès qu’une seule série existe, sans rien effacer', async () => {
    // Une `SetEntry` pointe sur son exercice : le supprimer effacerait des
    // séances. C'est le cas où l'archivage est la bonne réponse.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });

    await expect(deleteExercise(squat.id)).rejects.toBeInstanceOf(ExerciseHasHistoryError);

    expect(await db.exercises.get(squat.id)).toBeDefined();
    expect(await db.sets.count()).toBe(1);
  });

  it('refuse même sur une série d’échauffement', async () => {
    // Un échauffement est écarté des courbes et des records, mais c'est une
    // séance quand même : la règle est « une série existe », pas « une série
    // qui compte ».
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 40, reps: 8, kind: 'warmup' });

    await expect(deleteExercise(squat.id)).rejects.toBeInstanceOf(ExerciseHasHistoryError);
  });

  it('dit combien de séries bloquent', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 4, kind: 'work' });

    await expect(deleteExercise(squat.id)).rejects.toMatchObject({ setCount: 2 });
  });

  it('emporte un bloc de séance resté vide', async () => {
    // Ajouté à une séance puis jamais chargé : le bloc pointerait sur une
    // ligne disparue, et chaque lecture de la séance aurait à s'en défendre.
    const { session } = await startSession();
    await addExerciseToSession(session.id, cycling.id);

    await deleteExercise(cycling.id);

    expect(await db.sessionExercises.where('exerciseId').equals(cycling.id).count()).toBe(0);
  });

  it('libère le nom', async () => {
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
describe('une suppression survit à une mise à jour du catalogue', () => {
  /** Replays the backfill the way a future schema version would. */
  const replayBackfill = () =>
    db.transaction('rw', db.exercises, db.retiredExercises, (transaction) =>
      addMissingSeedExercises(transaction),
    );

  it('ne réintroduit pas un exercice supprimé', async () => {
    await deleteExercise(cycling.id);
    const after = await db.exercises.count();

    await replayBackfill();

    expect(await db.exercises.count()).toBe(after);
    expect(await db.exercises.where('nameKey').equals(cycling.nameKey).count()).toBe(0);
  });

  it('n’en réintroduit aucun, sur plusieurs suppressions', async () => {
    const running = await exerciseByKey('running');
    await deleteExercise(cycling.id);
    await deleteExercise(running.id);

    await replayBackfill();

    expect(await db.exercises.where('nameKey').equals(cycling.nameKey).count()).toBe(0);
    expect(await db.exercises.where('nameKey').equals(running.nameKey).count()).toBe(0);
  });

  it('réintroduit bien ce qui n’a pas été supprimé', async () => {
    // Le garde-fou du garde-fou : si le backfill n'ajoutait plus rien du tout,
    // les tests ci-dessus passeraient pour la mauvaise raison.
    await db.exercises.delete(squat.id);

    await replayBackfill();

    expect(await db.exercises.where('nameKey').equals(squat.nameKey).count()).toBe(1);
  });

  it('ne duplique pas ce qui est déjà là', async () => {
    const before = await db.exercises.count();

    await replayBackfill();

    expect(await db.exercises.count()).toBe(before);
  });
});
