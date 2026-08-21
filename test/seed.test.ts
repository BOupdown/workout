import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { buildSeedExercises } from '../lib/db/seed';
import { createExercise, listSelectableExercises } from '../lib/db/exercises';
import { checkExerciseShape } from '../lib/db/validation';
import type { Exercise } from '../lib/db/types';
import { CUSTOM_EXERCISE_NAME, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('le catalogue livré', () => {
  it('n’a aucun nom en double', async () => {
    // `&nameKey` est unique : un doublon ferait échouer `on('populate')`, donc
    // rendrait l'app inouvrable pour toute nouvelle installation. C'est le seul
    // défaut de cette liste qui casse tout d'un coup.
    const keys = buildSeedExercises().map((exercise) => exercise.nameKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ne contient que des lignes valides', async () => {
    for (const exercise of buildSeedExercises()) {
      expect(checkExerciseShape(exercise)).toEqual([]);
    }
  });

  it('est entièrement livré à la création', async () => {
    const shipped = buildSeedExercises();
    expect(await db.exercises.count()).toBe(shipped.length);
  });

  it('laisse libre le nom que les tests utilisent', async () => {
    // Sinon chaque test créant un exercice personnalisé tombe d'un coup, pour
    // une raison sans rapport avec ce qu'il vérifie — ce qui est arrivé le jour
    // où « Face pull » a été livré.
    await expect(
      createExercise({ name: CUSTOM_EXERCISE_NAME, loadType: 'external', metric: 'reps' }),
    ).resolves.toBeDefined();
  });

  it('n’est pas si long qu’on ne puisse plus le parcourir', async () => {
    // Une borne, pas un chiffre magique : un sélecteur qu'on ne peut pas
    // survoler coûte une recherche à chaque séance, alors qu'un exercice
    // manquant coûte dix secondes une seule fois.
    expect((await listSelectableExercises()).length).toBeLessThanOrEqual(80);
  });
});

/**
 * The v5 → v6 upgrade, exercised against a database that predates the
 * additions — the only shape where it does anything at all.
 */
describe('les ajouts au catalogue atteignent une base existante', () => {
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

  it('ajoute ce qui manque', async () => {
    const shipped = buildSeedExercises();
    await upgradeFrom(shipped.slice(0, 5));

    expect(await db.exercises.count()).toBe(shipped.length);
  });

  it('ne duplique pas ce qui est déjà là', async () => {
    const shipped = buildSeedExercises();
    await upgradeFrom(shipped);

    expect(await db.exercises.count()).toBe(shipped.length);
  });

  it('ne touche pas à un exercice que l’utilisateur a créé sous le même nom', async () => {
    // `&nameKey` est unique : écraser reviendrait à perdre son historique, et
    // ferait avorter la migration. On saute, il garde le sien.
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

  it('conserve l’historique attaché aux exercices déjà présents', async () => {
    const shipped = buildSeedExercises();
    const kept = shipped.slice(0, 3);
    await upgradeFrom(kept);

    for (const exercise of kept) {
      expect(await db.exercises.get(exercise.id)).toBeDefined();
    }
  });
});
