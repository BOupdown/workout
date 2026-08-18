import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { createSet, deleteSet, recentSetsForExercise, updateSet } from '../lib/db/sets';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise, SetEntry } from '../lib/db/types';
import { SetValidationError, setFieldRequirements } from '../lib/db/validation';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pompes: Exercise;
let gainage: Exercise;
let traction: Exercise;

let sessionId: string;
let blocks: Record<'squat' | 'pompes' | 'gainage' | 'traction', string>;

const startedAt = Date.parse('2026-08-16T09:00:00Z');

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pompes, gainage, traction } = await referenceExercises());

  const { session } = await startSession({ startedAt, bodyweightKg: 78 });
  sessionId = session.id;

  const [b1, b2, b3, b4] = await Promise.all([
    addExerciseToSession(sessionId, squat.id),
    addExerciseToSession(sessionId, pompes.id),
    addExerciseToSession(sessionId, gainage.id),
    addExerciseToSession(sessionId, traction.id),
  ]);
  blocks = { squat: b1.id, pompes: b2.id, gainage: b3.id, traction: b4.id };
});

describe('setFieldRequirements', () => {
  it('exige une charge pour un exercice à charge externe', () => {
    expect(setFieldRequirements(squat).weightKg).toBe('required');
    expect(setFieldRequirements(squat).weightLabel).toBe('Charge');
  });

  it('interdit la charge au poids du corps', () => {
    expect(setFieldRequirements(pompes).weightKg).toBe('forbidden');
    expect(setFieldRequirements(pompes).weightLabel).toBeNull();
  });

  it('bascule reps ↔ durée selon la metric', () => {
    expect(setFieldRequirements(gainage).durationSec).toBe('required');
    expect(setFieldRequirements(gainage).reps).toBe('forbidden');
    expect(setFieldRequirements(squat).reps).toBe('required');
    expect(setFieldRequirements(squat).durationSec).toBe('forbidden');
  });

  it('nomme la charge selon sa nature', () => {
    expect(setFieldRequirements(traction).weightLabel).toBe('Lest');
  });
});

describe('createSet — cas valides', () => {
  it('numérote les séries dans l’ordre d’ajout', async () => {
    const a = await createSet({ sessionExerciseId: blocks.squat, kind: 'warmup', weightKg: 40, reps: 10 });
    const b = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const c = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    expect([a.order, b.order, c.order]).toEqual([0, 1, 2]);
  });

  it('considère une série comme série de travail par défaut', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    expect(set.kind).toBe('work');
  });

  it('dérive les champs dénormalisés depuis les parents', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    expect(set.sessionId).toBe(sessionId);
    expect(set.exerciseId).toBe(squat.id);
    expect(set.performedAt).toBe(startedAt);
  });

  it('horodate la saisie indépendamment de la date de séance', async () => {
    const before = Date.now();
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    expect(set.loggedAt).toBeGreaterThanOrEqual(before);
    expect(set.performedAt).toBe(startedAt);
  });

  it('n’écrit aucune charge pour un exercice au poids du corps', async () => {
    const set = await createSet({ sessionExerciseId: blocks.pompes, reps: 25 });

    expect(set.weightKg).toBeUndefined();
    expect('weightKg' in set).toBe(false);
  });

  it('accepte une série au temps', async () => {
    const set = await createSet({ sessionExerciseId: blocks.gainage, durationSec: 90 });

    expect(set.durationSec).toBe(90);
    expect(set.reps).toBeUndefined();
  });

  it('accepte un lest nul puis sa progression', async () => {
    const sansLest = await createSet({ sessionExerciseId: blocks.traction, weightKg: 0, reps: 8 });
    const avecLest = await createSet({ sessionExerciseId: blocks.traction, weightKg: 10, reps: 4 });

    expect(sansLest.weightKg).toBe(0);
    expect(avecLest.weightKg).toBe(10);
  });
});

describe('createSet — invariants dépendants de l’exercice', () => {
  const rejects = async (input: Parameters<typeof createSet>[0], field: string) => {
    await expect(createSet(input)).rejects.toThrow(SetValidationError);
    await createSet(input).catch((err: SetValidationError) => {
      expect(err.issues.map((i) => i.field)).toContain(field);
    });
  };

  it('refuse une charge sur un exercice au poids du corps', async () => {
    await rejects({ sessionExerciseId: blocks.pompes, weightKg: 20, reps: 10 }, 'weightKg');
  });

  it('refuse des répétitions sur un exercice au temps', async () => {
    await rejects({ sessionExerciseId: blocks.gainage, reps: 10 }, 'reps');
  });

  it('refuse une durée sur un exercice en répétitions', async () => {
    await rejects({ sessionExerciseId: blocks.squat, weightKg: 60, durationSec: 30 }, 'durationSec');
  });

  it('refuse une charge manquante', async () => {
    await rejects({ sessionExerciseId: blocks.squat, reps: 5 }, 'weightKg');
  });

  it('refuse des répétitions manquantes', async () => {
    await rejects({ sessionExerciseId: blocks.squat, weightKg: 60 }, 'reps');
  });

  it('cite l’exercice concerné dans le message', async () => {
    await createSet({ sessionExerciseId: blocks.pompes, weightKg: 20, reps: 10 }).catch(
      (err: SetValidationError) => {
        expect(err.message).toContain('Pompes');
      },
    );
  });
});

describe('createSet — invariants structurels', () => {
  it.each([
    ['répétitions non entières', { weightKg: 60, reps: 5.5 }, 'reps'],
    ['charge négative', { weightKg: -20, reps: 5 }, 'weightKg'],
    ['charge aberrante', { weightKg: 5000, reps: 5 }, 'weightKg'],
    ['RPE hors bornes', { weightKg: 60, reps: 5, rpe: 12 }, 'rpe'],
    ['RPE hors demi-points', { weightKg: 60, reps: 5, rpe: 8.3 }, 'rpe'],
  ])('refuse %s', async (_label, payload, field) => {
    await createSet({ sessionExerciseId: blocks.squat, ...payload }).then(
      () => expect.unreachable('la série aurait dû être refusée'),
      (err: SetValidationError) => {
        expect(err).toBeInstanceOf(SetValidationError);
        expect(err.issues.map((i) => i.field)).toContain(field);
      },
    );
  });

  it('n’écrit rien quand la validation échoue', async () => {
    await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: blocks.squat, weightKg: -1, reps: 5 }).catch(() => {});

    expect(await db.sets.where('sessionExerciseId').equals(blocks.squat).count()).toBe(1);
  });
});

describe('hooks Dexie — contournement de la couche d’écriture', () => {
  const rawSet = (overrides: Partial<SetEntry>) =>
    ({
      id: 'brut',
      sessionExerciseId: blocks.squat,
      sessionId,
      exerciseId: squat.id,
      performedAt: startedAt,
      loggedAt: Date.now(),
      order: 99,
      kind: 'work',
      weightKg: 60,
      reps: 5,
      ...overrides,
    }) as SetEntry;

  /** Série brute amputée d'un champ requis, pour éprouver le hook structurel. */
  const rawSetWithout = (field: keyof SetEntry): SetEntry => {
    const entry = rawSet({}) as unknown as Record<string, unknown>;
    delete entry[field];
    return entry as unknown as SetEntry;
  };

  it('refuse un add() direct avec un kind inconnu', async () => {
    await expect(
      db.sets.add(rawSet({ kind: 'bidon' as SetEntry['kind'] })),
    ).rejects.toThrow(SetValidationError);
  });

  it.each(['sessionId', 'exerciseId', 'performedAt', 'loggedAt', 'order'] as const)(
    'refuse un add() direct sans %s',
    async (field) => {
      await expect(db.sets.add(rawSetWithout(field))).rejects.toThrow(SetValidationError);
    },
  );

  it('refuse un update() direct qui casse un invariant', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await expect(db.sets.update(set.id, { reps: -3 })).rejects.toThrow(SetValidationError);
  });
});

describe('updateSet', () => {
  it('corrige une charge', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5, rpe: 8 });
    const updated = await updateSet(set.id, { weightKg: 102.5 });

    expect(updated.weightKg).toBe(102.5);
    expect((await db.sets.get(set.id))!.weightKg).toBe(102.5);
  });

  it('efface un champ optionnel passé à undefined', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5, rpe: 8 });
    const updated = await updateSet(set.id, { rpe: undefined });

    expect(updated.rpe).toBeUndefined();
    expect((await db.sets.get(set.id))!.rpe).toBeUndefined();
  });

  it('laisse intactes les clés absentes du patch', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5, rpe: 8 });
    const updated = await updateSet(set.id, { reps: 6 });

    expect(updated.rpe).toBe(8);
    expect(updated.weightKg).toBe(100);
  });

  it('refuse un patch qui rendrait la série incohérente', async () => {
    const set = await createSet({ sessionExerciseId: blocks.pompes, reps: 25 });
    await expect(updateSet(set.id, { weightKg: 50 })).rejects.toThrow(SetValidationError);

    const untouched = (await db.sets.get(set.id))!;
    expect(untouched.weightKg).toBeUndefined();
    expect(untouched.reps).toBe(25);
  });
});

describe('deleteSet', () => {
  it('supprime sans renuméroter les suivantes', async () => {
    const a = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const b = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const c = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    await deleteSet(b.id);

    const remaining = await db.sets.where('sessionExerciseId').equals(blocks.squat).sortBy('order');
    expect(remaining.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(remaining.map((s) => s.order)).toEqual([0, 2]);
  });

  it('laisse la série suivante s’ajouter après la dernière', async () => {
    const a = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const b = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await deleteSet(b.id);

    const next = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    expect(next.order).toBeGreaterThan(a.order);
  });
});

describe('recentSetsForExercise', () => {
  beforeEach(async () => {
    // Séance précédente, une semaine plus tôt.
    const older = Date.parse('2026-08-09T09:00:00Z');
    const { session } = await startSession({ startedAt: older });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 95, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 95, reps: 5 });

    // Séance du jour : un échauffement puis deux séries de travail.
    await createSet({ sessionExerciseId: blocks.squat, kind: 'warmup', weightKg: 40, reps: 10 });
    await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
  });

  it('remonte les séries les plus récentes d’abord', async () => {
    const recent = await recentSetsForExercise(squat.id, 5);
    const timestamps = recent.map((s) => s.performedAt);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('respecte l’ordre exact à l’intérieur d’une séance', async () => {
    const recent = await recentSetsForExercise(squat.id, 5);
    expect(recent[0].order).toBe(2);
    expect(recent[1].order).toBe(1);
  });

  it('exclut les échauffements par défaut', async () => {
    const recent = await recentSetsForExercise(squat.id, 10);

    expect(recent.every((s) => s.kind === 'work')).toBe(true);
    expect(recent).toHaveLength(4);
  });

  it('inclut les échauffements sur demande', async () => {
    const recent = await recentSetsForExercise(squat.id, 10, { includeWarmups: true });

    expect(recent).toHaveLength(5);
    expect(recent.some((s) => s.kind === 'warmup')).toBe(true);
  });

  it('respecte la limite demandée', async () => {
    expect(await recentSetsForExercise(squat.id, 2)).toHaveLength(2);
  });

  it('n’en mélange pas les exercices', async () => {
    await createSet({ sessionExerciseId: blocks.pompes, reps: 25 });
    expect(await recentSetsForExercise(pompes.id, 10)).toHaveLength(1);
  });

  it('reste correct sur un volume qui dépasse la limite', async () => {
    // Vérifie que la requête traverse bien l'index composé à trois composantes,
    // et pas seulement les quelques lignes des tests précédents.
    for (let i = 0; i < 60; i++) {
      await createSet({ sessionExerciseId: blocks.squat, weightKg: 60 + i, reps: 5 });
    }

    const recent = await recentSetsForExercise(squat.id, 5);
    expect(recent).toHaveLength(5);
    expect(recent[0].weightKg).toBe(119);
  });
});
