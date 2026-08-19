import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { archiveExercise } from '../lib/db/exercises';
import { getSessionDetail, listSessionSummaries } from '../lib/db/queries';
import { createSet } from '../lib/db/sets';
import {
  addExerciseToSession,
  endSession,
  removeExerciseFromSession,
  reorderSessionExercises,
  startSession,
} from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank } = await referenceExercises());
});

/** Séance complète : squat (échauffement + 2 séries), pushUps (1), plank (1). */
async function buildFullSession(startedAt = new Date(2026, 7, 16, 19, 0).getTime()) {
  const { session } = await startSession({ startedAt, title: 'Full body' });

  const squatBlock = await addExerciseToSession(session.id, squat.id);
  const pompesBlock = await addExerciseToSession(session.id, pushUps.id);
  const gainageBlock = await addExerciseToSession(session.id, plank.id);

  await createSet({ sessionExerciseId: squatBlock.id, kind: 'warmup', weightKg: 40, reps: 10 });
  await createSet({ sessionExerciseId: squatBlock.id, weightKg: 100, reps: 5 });
  await createSet({ sessionExerciseId: squatBlock.id, weightKg: 100, reps: 5 });
  await createSet({ sessionExerciseId: pompesBlock.id, reps: 25 });
  await createSet({ sessionExerciseId: gainageBlock.id, durationSec: 90 });

  return { session, squatBlock, pompesBlock, gainageBlock };
}

describe('getSessionDetail', () => {
  it('ne retourne rien pour une séance inconnue', async () => {
    expect(await getSessionDetail('inconnue')).toBeUndefined();
  });

  it('reprend les champs de la séance', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.id).toBe(session.id);
    expect(detail.date).toBe('2026-08-16');
    expect(detail.title).toBe('Full body');
    expect(detail.startedAt).toBe(session.startedAt);
  });

  it('rend les blocs dans l’ordre de la séance', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries.map((e) => e.exercise.name)).toEqual(['Squat', 'Push-ups', 'Plank']);
    expect(detail.entries.map((e) => e.order)).toEqual([0, 1, 2]);
  });

  it('résout l’exercice de chaque bloc', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries[0].exercise.id).toBe(squat.id);
    expect(detail.entries[0].exercise.loadType).toBe('external');
    expect(detail.entries[2].exercise.metric).toBe('time');
  });

  it('rattache chaque série à son bloc, triée par order', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries.map((e) => e.sets.length)).toEqual([3, 1, 1]);
    expect(detail.entries[0].sets.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(detail.entries[0].sets.map((s) => s.weightKg)).toEqual([40, 100, 100]);
  });

  it('conserve les échauffements', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries[0].sets.map((s) => s.kind)).toEqual(['warmup', 'work', 'work']);
  });

  it('retourne un bloc sans série avec une liste vide', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.entries).toHaveLength(1);
    expect(detail.entries[0].sets).toEqual([]);
  });

  it('retourne une séance vide sans bloc', async () => {
    const { session } = await startSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries).toEqual([]);
  });

  it('distingue deux blocs du même exercice', async () => {
    const { session } = await startSession();
    const first = await addExerciseToSession(session.id, squat.id);
    const second = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: first.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: second.id, weightKg: 60, reps: 12 });

    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0].id).toBe(first.id);
    expect(detail.entries[0].sets[0].weightKg).toBe(100);
    expect(detail.entries[1].sets[0].weightKg).toBe(60);
  });

  it('n’emprunte aucune série à une autre séance', async () => {
    const first = await buildFullSession(new Date(2026, 7, 9, 19, 0).getTime());
    const second = await buildFullSession(new Date(2026, 7, 16, 19, 0).getTime());

    const detail = (await getSessionDetail(second.session.id))!;
    const ids = detail.entries.flatMap((e) => e.sets.map((s) => s.sessionId));

    expect(new Set(ids)).toEqual(new Set([second.session.id]));
    expect(detail.entries.flatMap((e) => e.sets)).toHaveLength(5);
    expect(first.session.id).not.toBe(second.session.id);
  });

  it('reflète un réordonnancement des blocs', async () => {
    const { session, squatBlock, pompesBlock, gainageBlock } = await buildFullSession();
    await reorderSessionExercises(session.id, [gainageBlock.id, squatBlock.id, pompesBlock.id]);

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.entries.map((e) => e.exercise.name)).toEqual(['Plank', 'Squat', 'Push-ups']);
  });

  it('reflète le retrait d’un bloc', async () => {
    const { session, pompesBlock } = await buildFullSession();
    await removeExerciseFromSession(pompesBlock.id, { force: true });

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.entries.map((e) => e.exercise.name)).toEqual(['Squat', 'Plank']);
    expect(detail.entries.flatMap((e) => e.sets)).toHaveLength(4);
  });

  it('retourne normalement un exercice archivé', async () => {
    // Le point de la décision : l'archivage ne concerne que la sélection.
    // Filtrer ici ferait disparaître un bloc d'une séance passée alors que ses
    // séries existent toujours.
    const { session } = await buildFullSession();
    await archiveExercise(squat.id);

    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries.map((e) => e.exercise.name)).toContain('Squat');
    expect(detail.entries[0].exercise.archivedAt).toBeDefined();
    expect(detail.entries[0].sets).toHaveLength(3);
  });

  it('échoue bruyamment si un bloc désigne un exercice disparu', async () => {
    const { session } = await buildFullSession();
    await db.exercises.delete(squat.id);

    await expect(getSessionDetail(session.id)).rejects.toThrow(/Inconsistent database/);
  });
});

describe('listSessionSummaries', () => {
  it('ne retourne rien sur une base vierge', async () => {
    expect(await listSessionSummaries()).toEqual([]);
  });

  it('trie de la plus récente à la plus ancienne', async () => {
    await buildFullSession(new Date(2026, 7, 2, 19, 0).getTime());
    await buildFullSession(new Date(2026, 7, 9, 19, 0).getTime());
    await buildFullSession(new Date(2026, 7, 16, 19, 0).getTime());

    const summaries = await listSessionSummaries();
    expect(summaries.map((s) => s.date)).toEqual(['2026-08-16', '2026-08-09', '2026-08-02']);
  });

  it('compte blocs et séries sans se tromper', async () => {
    await buildFullSession();
    const [summary] = await listSessionSummaries();

    expect(summary.exerciseCount).toBe(3);
    // Échauffement compris : 3 séries de squat, 1 de pushUps, 1 de plank.
    expect(summary.setCount).toBe(5);
  });

  it('liste les noms d’exercices dans l’ordre de la séance', async () => {
    await buildFullSession();
    const [summary] = await listSessionSummaries();

    expect(summary.exerciseNames).toEqual(['Squat', 'Push-ups', 'Plank']);
  });

  it('garde exerciseNames aligné sur exerciseCount, doublons compris', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await addExerciseToSession(session.id, pushUps.id);
    await addExerciseToSession(session.id, squat.id);

    const [summary] = await listSessionSummaries();

    expect(summary.exerciseNames).toEqual(['Squat', 'Push-ups', 'Squat']);
    expect(summary.exerciseCount).toBe(summary.exerciseNames.length);
  });

  it('gère une séance sans aucun bloc', async () => {
    await startSession();
    const [summary] = await listSessionSummaries();

    expect(summary.exerciseCount).toBe(0);
    expect(summary.exerciseNames).toEqual([]);
    expect(summary.setCount).toBe(0);
  });

  it('ne compte pas les séries des autres séances', async () => {
    await buildFullSession(new Date(2026, 7, 9, 19, 0).getTime());
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 0).getTime() });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const summaries = await listSessionSummaries();
    expect(summaries[0].setCount).toBe(1);
    expect(summaries[1].setCount).toBe(5);
  });

  it('reste correct sur une séance volumineuse', async () => {
    // Vérifie que le comptage indexé donne le même résultat qu'une lecture
    // complète, à un volume où la différence de coût compte réellement.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    for (let i = 0; i < 80; i++) {
      await createSet({ sessionExerciseId: block.id, weightKg: 60, reps: 5 });
    }

    const [summary] = await listSessionSummaries();
    expect(summary.setCount).toBe(80);
    expect(summary.exerciseCount).toBe(1);
  });

  it('reprend le titre quand il existe', async () => {
    await buildFullSession();
    await startSession({ startedAt: new Date(2026, 7, 17, 19, 0).getTime() });

    const summaries = await listSessionSummaries();
    expect('title' in summaries[0]).toBe(false);
    expect(summaries[1].title).toBe('Full body');
  });

  it('calcule la durée d’une séance clôturée', async () => {
    const startedAt = new Date(2026, 7, 16, 19, 0).getTime();
    const { session } = await startSession({ startedAt });
    await endSession(session.id, startedAt + 4_500_000);

    const [summary] = await listSessionSummaries();
    expect(summary.endedAt).toBe(startedAt + 4_500_000);
    expect(summary.durationMs).toBe(4_500_000);
  });

  it('laisse la durée absente tant que la séance est en cours', async () => {
    await startSession();
    const [summary] = await listSessionSummaries();

    expect(summary.endedAt).toBeUndefined();
    expect('durationMs' in summary).toBe(false);
  });

  it('nomme normalement un exercice archivé', async () => {
    await buildFullSession();
    await archiveExercise(squat.id);

    const [summary] = await listSessionSummaries();
    expect(summary.exerciseNames).toContain('Squat');
  });
});

describe('listSessionSummaries — pagination', () => {
  const dates = [2, 9, 16, 23, 30];

  beforeEach(async () => {
    for (const day of dates) {
      await startSession({ startedAt: new Date(2026, 7, day, 19, 0).getTime() });
    }
  });

  it('respecte la limite demandée', async () => {
    expect(await listSessionSummaries({ limit: 2 })).toHaveLength(2);
  });

  it('enchaîne les pages sans recouvrement ni trou', async () => {
    const first = await listSessionSummaries({ limit: 2 });
    const second = await listSessionSummaries({ limit: 2, before: first[1].startedAt });
    const third = await listSessionSummaries({ limit: 2, before: second[1].startedAt });

    const ids = [...first, ...second, ...third].map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    expect(third).toHaveLength(1);

    const all = await listSessionSummaries();
    expect(ids).toEqual(all.map((s) => s.id));
  });

  it('exclut strictement le curseur', async () => {
    const all = await listSessionSummaries();
    const page = await listSessionSummaries({ before: all[0].startedAt });

    expect(page.map((s) => s.id)).not.toContain(all[0].id);
    expect(page).toHaveLength(4);
  });

  it('retourne une page vide au-delà de la plus ancienne', async () => {
    const all = await listSessionSummaries();
    const beyond = await listSessionSummaries({ before: all[all.length - 1].startedAt });

    expect(beyond).toEqual([]);
  });
});
