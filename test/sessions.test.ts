import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { createSet } from '../lib/db/sets';
import {
  addExerciseToSession,
  deleteSession,
  endSession,
  getActiveSession,
  listSessionExercises,
  removeExerciseFromSession,
  reorderSessionExercises,
  SessionExerciseNotEmptyError,
  startSession,
  updateSessionDate,
} from '../lib/db/sessions';
import type { Exercise, Session } from '../lib/db/types';
import {
  SessionExerciseValidationError,
  SessionValidationError,
} from '../lib/db/validation';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pompes: Exercise;
let gainage: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pompes, gainage } = await referenceExercises());
});

describe('startSession', () => {
  it('dérive le jour local et l’identifiant', async () => {
    const startedAt = new Date(2026, 7, 16, 19, 30).getTime();
    const { session } = await startSession({ startedAt });

    expect(session.date).toBe('2026-08-16');
    expect(session.id).toBeTruthy();
    expect(session.endedAt).toBeUndefined();
  });

  it('accepte les champs optionnels sans matérialiser les absents', async () => {
    const { session } = await startSession({ title: 'Push A', bodyweightKg: 78 });

    expect(session.title).toBe('Push A');
    expect(session.bodyweightKg).toBe(78);
    expect('notes' in session).toBe(false);
  });

  it('refuse un poids de corps aberrant', async () => {
    await expect(startSession({ bodyweightKg: 900 })).rejects.toThrow(SessionValidationError);
  });
});

describe('séance restée ouverte', () => {
  it('clôture automatiquement la précédente et la signale', async () => {
    const first = await startSession({ startedAt: Date.parse('2026-08-09T09:00:00Z') });
    const second = await startSession({ startedAt: Date.parse('2026-08-16T09:00:00Z') });

    expect(second.autoClosed?.id).toBe(first.session.id);
    expect(second.autoClosed?.endedAt).toBeDefined();

    const reloaded = await db.sessions.get(first.session.id);
    expect(reloaded!.endedAt).toBeDefined();
  });

  it('clôture à la dernière série saisie, pas à « maintenant »', async () => {
    const startedAt = Date.parse('2026-08-09T09:00:00Z');
    const { session } = await startSession({ startedAt });
    const block = await addExerciseToSession(session.id, squat.id);
    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { autoClosed } = await startSession();

    // Sans `loggedAt`, la séance oubliée depuis une semaine afficherait une
    // durée de sept jours.
    expect(autoClosed!.endedAt).toBe(set.loggedAt);
  });

  it('retombe sur startedAt quand la séance ne contient aucune série', async () => {
    const startedAt = Date.parse('2026-08-09T09:00:00Z');
    const { session } = await startSession({ startedAt });

    const { autoClosed } = await startSession();
    expect(autoClosed!.endedAt).toBe(session.startedAt);
  });

  it('ne laisse jamais deux séances ouvertes', async () => {
    await startSession();
    await startSession();
    await startSession();

    const open = await db.sessions.filter((s) => s.endedAt === undefined).toArray();
    expect(open).toHaveLength(1);
  });

  it('n’ouvre pas de séance parasite quand il n’y avait rien à clôturer', async () => {
    const { autoClosed } = await startSession();
    expect(autoClosed).toBeUndefined();
  });
});

describe('getActiveSession', () => {
  it('ne retourne rien sur une base vierge', async () => {
    expect(await getActiveSession()).toBeUndefined();
  });

  it('retrouve la séance en cours', async () => {
    const { session } = await startSession();
    expect((await getActiveSession())?.id).toBe(session.id);
  });

  it('ne clôture pas la séance qu’elle retrouve', async () => {
    // Le point clé du choix de conception : rouvrir l'app entre deux séries
    // doit reprendre la séance, pas la terminer.
    await startSession();
    await getActiveSession();

    expect((await getActiveSession())?.endedAt).toBeUndefined();
  });

  it('ne retourne rien après clôture', async () => {
    const { session } = await startSession();
    await endSession(session.id);

    expect(await getActiveSession()).toBeUndefined();
  });
});

describe('endSession', () => {
  it('clôture la séance', async () => {
    const { session } = await startSession();
    const ended = await endSession(session.id);

    expect(ended.endedAt).toBeDefined();
    expect((await db.sessions.get(session.id))!.endedAt).toBeDefined();
  });

  it('est idempotent — un double appui ne doit pas produire d’erreur', async () => {
    const { session } = await startSession();
    const first = await endSession(session.id);
    const second = await endSession(session.id);

    expect(second.endedAt).toBe(first.endedAt);
  });

  it('refuse une fin antérieure au début', async () => {
    const startedAt = Date.parse('2026-08-16T09:00:00Z');
    const { session } = await startSession({ startedAt });

    await expect(endSession(session.id, startedAt - 1000)).rejects.toThrow(
      SessionValidationError,
    );
  });

  it('lève sur une séance inconnue', async () => {
    await expect(endSession('inconnue')).rejects.toThrow(/introuvable/);
  });
});

describe('updateSessionDate', () => {
  it('propage performedAt sur toutes les séries de la séance', async () => {
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 0).getTime() });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const updated = await updateSessionDate(session.id, '2026-08-15');

    const sets = await db.sets.where('sessionId').equals(session.id).toArray();
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => s.performedAt === updated.startedAt)).toBe(true);
  });

  it('conserve l’heure de la journée', async () => {
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 30).getTime() });
    const updated = await updateSessionDate(session.id, '2026-08-15');

    const moved = new Date(updated.startedAt);
    expect(updated.date).toBe('2026-08-15');
    expect(moved.getHours()).toBe(19);
    expect(moved.getMinutes()).toBe(30);
  });

  it('décale endedAt du même écart', async () => {
    const startedAt = new Date(2026, 7, 16, 19, 0).getTime();
    const { session } = await startSession({ startedAt });
    await endSession(session.id, startedAt + 3_600_000);

    const updated = await updateSessionDate(session.id, '2026-08-15');
    expect(updated.endedAt! - updated.startedAt).toBe(3_600_000);
  });

  it('garde l’historique par exercice cohérent après déplacement', async () => {
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 0).getTime() });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await updateSessionDate(session.id, '2026-01-05');

    const set = (await db.sets.where('sessionId').equals(session.id).toArray())[0];
    const reloaded = (await db.sessions.get(session.id))!;
    expect(set.performedAt).toBe(reloaded.startedAt);
  });

  it('refuse un jour inexistant', async () => {
    const { session } = await startSession();
    await expect(updateSessionDate(session.id, '2026-02-30')).rejects.toThrow(RangeError);
  });
});

describe('addExerciseToSession', () => {
  it('numérote les blocs dans l’ordre d’ajout', async () => {
    const { session } = await startSession();
    const a = await addExerciseToSession(session.id, squat.id);
    const b = await addExerciseToSession(session.id, pompes.id);

    expect([a.order, b.order]).toEqual([0, 1]);
  });

  it('accepte deux fois le même exercice dans une séance', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await addExerciseToSession(session.id, squat.id);

    expect(await listSessionExercises(session.id)).toHaveLength(2);
  });

  it('refuse un exercice archivé', async () => {
    await db.exercises.update(gainage.id, { archivedAt: Date.now() });
    const { session } = await startSession();

    await expect(addExerciseToSession(session.id, gainage.id)).rejects.toThrow(
      SessionExerciseValidationError,
    );
  });

  it('lève sur une séance ou un exercice inconnu', async () => {
    const { session } = await startSession();
    await expect(addExerciseToSession('inconnue', squat.id)).rejects.toThrow(/introuvable/);
    await expect(addExerciseToSession(session.id, 'inconnu')).rejects.toThrow(/introuvable/);
  });
});

describe('removeExerciseFromSession', () => {
  it('retire un bloc vide sans cérémonie', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);

    const { deletedSets } = await removeExerciseFromSession(block.id);

    expect(deletedSets).toBe(0);
    expect(await listSessionExercises(session.id)).toHaveLength(0);
  });

  it('refuse de retirer un bloc contenant des séries', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await expect(removeExerciseFromSession(block.id)).rejects.toThrow(
      SessionExerciseNotEmptyError,
    );
    expect(await listSessionExercises(session.id)).toHaveLength(1);
  });

  it('porte le nombre de séries pour que l’UI puisse confirmer', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await removeExerciseFromSession(block.id).then(
      () => expect.unreachable('le retrait aurait dû être refusé'),
      (err: SessionExerciseNotEmptyError) => {
        expect(err.setCount).toBe(2);
        expect(err.sessionExerciseId).toBe(block.id);
      },
    );
  });

  it('retire le bloc et ses séries avec force', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { deletedSets } = await removeExerciseFromSession(block.id, { force: true });

    expect(deletedSets).toBe(2);
    expect(await listSessionExercises(session.id)).toHaveLength(0);
    expect(await db.sets.where('sessionExerciseId').equals(block.id).count()).toBe(0);
  });

  it('ne touche pas aux autres blocs de la séance', async () => {
    const { session } = await startSession();
    const a = await addExerciseToSession(session.id, squat.id);
    const b = await addExerciseToSession(session.id, pompes.id);
    await createSet({ sessionExerciseId: b.id, reps: 25 });

    await removeExerciseFromSession(a.id);

    expect(await db.sets.where('sessionExerciseId').equals(b.id).count()).toBe(1);
  });
});

describe('reorderSessionExercises', () => {
  let session: Session;
  let ids: string[];

  beforeEach(async () => {
    ({ session } = await startSession());
    const blocks = [
      await addExerciseToSession(session.id, squat.id),
      await addExerciseToSession(session.id, pompes.id),
      await addExerciseToSession(session.id, gainage.id),
    ];
    ids = blocks.map((b) => b.id);
  });

  it('renumérote en 0…n-1 dans l’ordre demandé', async () => {
    const reordered = await reorderSessionExercises(session.id, [ids[2], ids[0], ids[1]]);

    expect(reordered.map((b) => b.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(reordered.map((b) => b.order)).toEqual([0, 1, 2]);
  });

  it('refuse un ordre partiel', async () => {
    await expect(reorderSessionExercises(session.id, [ids[0], ids[1]])).rejects.toThrow(
      /Réordonnancement invalide/,
    );
  });

  it('refuse un identifiant étranger à la séance', async () => {
    const { session: other } = await startSession();
    const foreign = await addExerciseToSession(other.id, squat.id);

    await expect(
      reorderSessionExercises(session.id, [ids[0], ids[1], foreign.id]),
    ).rejects.toThrow(/Réordonnancement invalide/);
  });

  it('refuse un doublon', async () => {
    await expect(
      reorderSessionExercises(session.id, [ids[0], ids[0], ids[1]]),
    ).rejects.toThrow(/Réordonnancement invalide/);
  });

  it('laisse l’ordre intact quand le réordonnancement est refusé', async () => {
    await reorderSessionExercises(session.id, [ids[0], ids[1]]).catch(() => {});

    const blocks = await listSessionExercises(session.id);
    expect(blocks.map((b) => b.id)).toEqual(ids);
  });
});

describe('deleteSession — cascade', () => {
  it('supprime la séance, ses blocs et ses séries', async () => {
    const { session } = await startSession();
    const a = await addExerciseToSession(session.id, squat.id);
    const b = await addExerciseToSession(session.id, pompes.id);
    await createSet({ sessionExerciseId: a.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: a.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: b.id, reps: 25 });

    await deleteSession(session.id);

    expect(await db.sessions.get(session.id)).toBeUndefined();
    expect(await db.sessionExercises.where('sessionId').equals(session.id).count()).toBe(0);
    expect(await db.sets.where('sessionId').equals(session.id).count()).toBe(0);
  });

  it('ne touche pas aux autres séances', async () => {
    const first = await startSession({ startedAt: Date.parse('2026-08-09T09:00:00Z') });
    const blockA = await addExerciseToSession(first.session.id, squat.id);
    await createSet({ sessionExerciseId: blockA.id, weightKg: 95, reps: 5 });

    const second = await startSession({ startedAt: Date.parse('2026-08-16T09:00:00Z') });
    const blockB = await addExerciseToSession(second.session.id, squat.id);
    await createSet({ sessionExerciseId: blockB.id, weightKg: 100, reps: 5 });

    await deleteSession(second.session.id);

    expect(await db.sessions.get(first.session.id)).toBeDefined();
    expect(await db.sets.where('sessionId').equals(first.session.id).count()).toBe(1);
    expect(await db.sets.count()).toBe(1);
  });

  it('laisse le catalogue d’exercices intact', async () => {
    const before = await db.exercises.count();
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await deleteSession(session.id);

    expect(await db.exercises.count()).toBe(before);
  });
});
