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
  it('dérive id, nameKey, isCustom et createdAt', async () => {
    const before = Date.now();
    const exercise = await createExercise({
      name: 'Face pull',
      loadType: 'external',
      metric: 'reps',
    });

    expect(exercise.id).toBeTruthy();
    expect(exercise.nameKey).toBe('face pull');
    expect(exercise.isCustom).toBe(true);
    expect(exercise.createdAt).toBeGreaterThanOrEqual(before);
    expect(exercise.archivedAt).toBeUndefined();
  });

  it('vaut false pour perSide par défaut', async () => {
    const exercise = await createExercise({
      name: 'Face pull',
      loadType: 'external',
      metric: 'reps',
    });
    expect(exercise.perSide).toBe(false);
  });

  it('ne matérialise pas les champs optionnels absents', async () => {
    const exercise = await createExercise({
      name: 'Face pull',
      loadType: 'external',
      metric: 'reps',
    });

    expect('muscleGroup' in exercise).toBe(false);
    expect('notes' in exercise).toBe(false);
    expect('defaultIncrementKg' in exercise).toBe(false);
  });

  it('persiste l’exercice et le rend sélectionnable', async () => {
    const exercise = await createExercise({
      name: 'Face pull',
      loadType: 'external',
      metric: 'reps',
      muscleGroup: 'shoulders',
      defaultIncrementKg: 1,
    });

    expect(await db.exercises.get(exercise.id)).toEqual(exercise);
    const selectable = await listSelectableExercises();
    expect(selectable.map((e) => e.id)).toContain(exercise.id);
  });

  it('accepte un exercice au poids du corps et au temps', async () => {
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
  it('refuse un nom déjà pris à la normalisation près', async () => {
    await expect(
      createExercise({ name: 'SQUAT', loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseNameConflictError);
  });

  it('refuse aussi une variante accentuée ou ponctuée', async () => {
    await createExercise({ name: 'Face pull', loadType: 'external', metric: 'reps' });

    await expect(
      createExercise({ name: 'face-pull !', loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseNameConflictError);
  });

  it('porte l’exercice existant pour que l’UI puisse le proposer', async () => {
    await createExercise({ name: 'Squat', loadType: 'bodyweight', metric: 'time' }).then(
      () => expect.unreachable('la création aurait dû être refusée'),
      (err: ExerciseNameConflictError) => {
        expect(err.existing.id).toBe(squat.id);
        // Le point de la décision : on ne rend jamais silencieusement
        // l'existant, dont le loadType n'est pas celui demandé.
        expect(err.existing.loadType).toBe('external');
        expect(err.existing.metric).toBe('reps');
      },
    );
  });

  it('signale qu’un homonyme est archivé', async () => {
    const custom = await createExercise({
      name: 'Face pull',
      loadType: 'external',
      metric: 'reps',
    });
    await archiveExercise(custom.id);

    await createExercise({ name: 'Face pull', loadType: 'external', metric: 'reps' }).then(
      () => expect.unreachable('la création aurait dû être refusée'),
      (err: ExerciseNameConflictError) => {
        expect(err.existing.archivedAt).toBeDefined();
        expect(err.message).toContain('archived');
      },
    );
  });

  it('n’écrit rien quand le nom est refusé', async () => {
    const before = await db.exercises.count();
    await createExercise({ name: 'SQUAT', loadType: 'external', metric: 'reps' }).catch(() => {});

    expect(await db.exercises.count()).toBe(before);
  });
});

describe('findExerciseByName', () => {
  it('retrouve un exercice à la normalisation près', async () => {
    expect((await findExerciseByName('  SQUAT  '))?.id).toBe(squat.id);
  });

  it('ne retourne rien pour un nom libre', async () => {
    expect(await findExerciseByName('Mouvement inexistant')).toBeUndefined();
  });
});

describe('validation structurelle', () => {
  it('refuse un nom vide', async () => {
    await expect(
      createExercise({ name: '   ', loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuse un nom trop long', async () => {
    await expect(
      createExercise({ name: 'x'.repeat(81), loadType: 'external', metric: 'reps' }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuse un groupe musculaire inconnu', async () => {
    await expect(
      createExercise({
        name: 'Face pull',
        loadType: 'external',
        metric: 'reps',
        muscleGroup: 'tentacules' as Exercise['muscleGroup'],
      }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuse un pas de progression sur un exercice au poids du corps', async () => {
    await expect(
      createExercise({
        name: 'Chaise contre le mur',
        loadType: 'bodyweight',
        metric: 'time',
        defaultIncrementKg: 2.5,
      }),
    ).rejects.toThrow(ExerciseValidationError);
  });

  it('refuse un add() direct dont nameKey ne dérive pas de name', async () => {
    // Sans cet invariant, un couple incohérent contournerait l'index unique
    // `&nameKey` et fragmenterait l'historique d'un même mouvement.
    await expect(
      db.exercises.add({
        id: 'incoherent',
        name: 'Bench press',
        nameKey: 'autre chose',
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
  it('renomme et redérive nameKey', async () => {
    const updated = await updateExercise(squat.id, { name: 'Squat barre haute' });

    expect(updated.name).toBe('Squat barre haute');
    expect(updated.nameKey).toBe('squat barre haute');
    expect((await db.exercises.get(squat.id))!.nameKey).toBe('squat barre haute');
  });

  it('libère l’ancien nom après renommage', async () => {
    await updateExercise(squat.id, { name: 'Squat barre haute' });

    const recreated = await createExercise({
      name: 'Squat',
      loadType: 'external',
      metric: 'reps',
    });
    expect(recreated.nameKey).toBe('squat');
  });

  it('refuse un renommage vers un nom déjà pris', async () => {
    await expect(updateExercise(squat.id, { name: 'Push-ups' })).rejects.toThrow(
      ExerciseNameConflictError,
    );
    expect((await db.exercises.get(squat.id))!.name).toBe('Squat');
  });

  it('accepte un renommage cosmétique qui ne change pas nameKey', async () => {
    const updated = await updateExercise(squat.id, { name: 'SQUAT' });
    expect(updated.name).toBe('SQUAT');
    expect(updated.nameKey).toBe('squat');
  });

  it('modifie groupe musculaire, pas de progression et notes', async () => {
    const updated = await updateExercise(squat.id, {
      muscleGroup: 'glutes',
      defaultIncrementKg: 5,
      notes: 'ceinture',
    });

    expect(updated.muscleGroup).toBe('glutes');
    expect(updated.defaultIncrementKg).toBe(5);
    expect(updated.notes).toBe('ceinture');
  });

  it('efface un champ optionnel passé à undefined', async () => {
    const updated = await updateExercise(squat.id, { defaultIncrementKg: undefined });

    expect(updated.defaultIncrementKg).toBeUndefined();
    expect((await db.exercises.get(squat.id))!.defaultIncrementKg).toBeUndefined();
  });

  it('laisse intactes les clés absentes du patch', async () => {
    const updated = await updateExercise(squat.id, { notes: 'test' });

    expect(updated.name).toBe('Squat');
    expect(updated.loadType).toBe('external');
    expect(updated.defaultIncrementKg).toBe(squat.defaultIncrementKg);
  });

  it('lève sur un exercice inconnu', async () => {
    await expect(updateExercise('inconnu', { notes: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('updateExercise — nature verrouillée par l’historique', () => {
  /** Enregistre une série de squat, pour que l'exercice soit « utilisé ». */
  async function logOneSquatSet() {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
  }

  it('autorise le changement de nature tant qu’aucune série n’existe', async () => {
    const updated = await updateExercise(squat.id, { loadType: 'bodyweight', metric: 'time' });

    expect(updated.loadType).toBe('bodyweight');
    expect(updated.metric).toBe('time');
  });

  it('efface le pas de progression en basculant au poids du corps', async () => {
    // Le catalogue donne 2,5 kg au squat ; devenu bodyweight, ce pas n'a plus
    // de sens. C'est une conséquence dérivée, pas une erreur à remonter.
    expect(squat.defaultIncrementKg).toBe(2.5);
    const updated = await updateExercise(squat.id, { loadType: 'bodyweight' });

    expect(updated.defaultIncrementKg).toBeUndefined();
    expect('defaultIncrementKg' in (await db.exercises.get(squat.id))!).toBe(false);
  });

  it('conserve le pas de progression pour les autres loadType', async () => {
    const updated = await updateExercise(squat.id, { loadType: 'weighted_bodyweight' });
    expect(updated.defaultIncrementKg).toBe(2.5);
  });

  it.each(['loadType', 'metric', 'perSide'] as const)(
    'refuse de modifier %s dès qu’une série existe',
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

  it('porte le nombre de séries et les champs verrouillés', async () => {
    await logOneSquatSet();
    await logOneSquatSet();

    await updateExercise(squat.id, { loadType: 'bodyweight', perSide: true }).then(
      () => expect.unreachable('la modification aurait dû être refusée'),
      (err: ExerciseInUseError) => {
        expect(err.setCount).toBe(2);
        expect(err.lockedFields).toEqual(['loadType', 'perSide']);
        expect(err.message).toContain('Archive it');
      },
    );
  });

  it('compte aussi les échauffements', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, kind: 'warmup', weightKg: 40, reps: 10 });

    await expect(updateExercise(squat.id, { metric: 'time' })).rejects.toThrow(
      ExerciseInUseError,
    );
  });

  it('traite comme un no-op le renvoi de la valeur courante', async () => {
    await logOneSquatSet();

    // L'UI renvoie souvent le formulaire entier : réécrire la valeur inchangée
    // d'un champ verrouillé ne doit pas être une erreur.
    const updated = await updateExercise(squat.id, {
      loadType: 'external',
      metric: 'reps',
      perSide: false,
      notes: 'barre haute',
    });

    expect(updated.notes).toBe('barre haute');
  });

  it('laisse les champs libres modifiables sur un exercice utilisé', async () => {
    await logOneSquatSet();
    const updated = await updateExercise(squat.id, { name: 'Squat barre haute' });

    expect(updated.name).toBe('Squat barre haute');
  });

  it('n’écrit rien quand la modification est refusée', async () => {
    await logOneSquatSet();
    await updateExercise(squat.id, { loadType: 'bodyweight', notes: 'perdu' }).catch(() => {});

    const reloaded = (await db.exercises.get(squat.id))!;
    expect(reloaded.loadType).toBe('external');
    expect(reloaded.notes).toBeUndefined();
  });
});

describe('archivage', () => {
  it('sort l’exercice du sélecteur', async () => {
    await archiveExercise(squat.id);

    const selectable = await listSelectableExercises();
    expect(selectable.map((e) => e.id)).not.toContain(squat.id);
  });

  it('le fait apparaître dans les archives', async () => {
    await archiveExercise(squat.id);

    const archived = await listArchivedExercises();
    expect(archived.map((e) => e.id)).toEqual([squat.id]);
  });

  it('est idempotent', async () => {
    const first = await archiveExercise(squat.id);
    const second = await archiveExercise(squat.id);

    expect(second.archivedAt).toBe(first.archivedAt);
  });

  it('empêche de l’ajouter à une nouvelle séance', async () => {
    await archiveExercise(squat.id);
    const { session } = await startSession();

    await expect(addExerciseToSession(session.id, squat.id)).rejects.toThrow(
      SessionExerciseValidationError,
    );
  });

  it('lève sur un exercice inconnu', async () => {
    await expect(archiveExercise('inconnu')).rejects.toThrow(/not found/);
  });
});

describe('archivage — l’historique reste intact', () => {
  it('conserve les séries déjà enregistrées', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await archiveExercise(squat.id);

    expect(await recentSetsForExercise(squat.id, 10)).toHaveLength(2);
    expect(await db.sessionExercises.get(block.id)).toBeDefined();
  });

  it('laisse finir une séance en cours qui contient déjà l’exercice', async () => {
    // Asymétrie volontaire : archiver bloque l'ajout d'un *nouveau* bloc, mais
    // pas la saisie dans un bloc déjà ouvert. On n'interrompt pas une séance.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await archiveExercise(squat.id);

    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    expect(set.order).toBe(1);
  });
});

describe('désarchivage', () => {
  it('remet l’exercice dans le sélecteur', async () => {
    await archiveExercise(squat.id);
    const restored = await unarchiveExercise(squat.id);

    expect(restored.archivedAt).toBeUndefined();
    expect((await listSelectableExercises()).map((e) => e.id)).toContain(squat.id);
    expect(await listArchivedExercises()).toHaveLength(0);
  });

  it('retire bien la propriété plutôt que de la mettre à undefined', async () => {
    await archiveExercise(squat.id);
    await unarchiveExercise(squat.id);

    const reloaded = (await db.exercises.get(squat.id))!;
    expect('archivedAt' in reloaded).toBe(false);
  });

  it('est idempotent sur un exercice non archivé', async () => {
    const untouched = await unarchiveExercise(pushUps.id);
    expect(untouched.archivedAt).toBeUndefined();
  });

  it('permet de nouveau de l’ajouter à une séance', async () => {
    await archiveExercise(squat.id);
    await unarchiveExercise(squat.id);

    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    expect(block.exerciseId).toBe(squat.id);
  });
});
