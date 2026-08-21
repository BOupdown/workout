import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { createSet } from '../lib/db/sets';
import { archiveExercise } from '../lib/db/exercises';
import {
  addExerciseToSession,
  deleteSession,
  endSession,
  getActiveSession,
  listSessionExercises,
  removeExerciseFromSession,
  reorderSessionExercises,
  SessionExerciseNotEmptyError,
  setSessionBodyweight,
  setSessionExerciseNotes,
  startSession,
  startSessionFrom,
  updateSessionDate,
  updateSessionText,
} from '../lib/db/sessions';
import type { Exercise, Session } from '../lib/db/types';
import {
  SessionExerciseValidationError,
  SessionValidationError,
} from '../lib/db/validation';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank } = await referenceExercises());
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
    await expect(endSession('inconnue')).rejects.toThrow(/not found/);
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
    const b = await addExerciseToSession(session.id, pushUps.id);

    expect([a.order, b.order]).toEqual([0, 1]);
  });

  it('accepte deux fois le même exercice dans une séance', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await addExerciseToSession(session.id, squat.id);

    expect(await listSessionExercises(session.id)).toHaveLength(2);
  });

  it('refuse un exercice archivé', async () => {
    await db.exercises.update(plank.id, { archivedAt: Date.now() });
    const { session } = await startSession();

    await expect(addExerciseToSession(session.id, plank.id)).rejects.toThrow(
      SessionExerciseValidationError,
    );
  });

  it('lève sur une séance ou un exercice inconnu', async () => {
    const { session } = await startSession();
    await expect(addExerciseToSession('inconnue', squat.id)).rejects.toThrow(/not found/);
    await expect(addExerciseToSession(session.id, 'inconnu')).rejects.toThrow(/not found/);
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
    const b = await addExerciseToSession(session.id, pushUps.id);
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
      await addExerciseToSession(session.id, pushUps.id),
      await addExerciseToSession(session.id, plank.id),
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
      /Invalid reorder/,
    );
  });

  it('refuse un identifiant étranger à la séance', async () => {
    const { session: other } = await startSession();
    const foreign = await addExerciseToSession(other.id, squat.id);

    await expect(
      reorderSessionExercises(session.id, [ids[0], ids[1], foreign.id]),
    ).rejects.toThrow(/Invalid reorder/);
  });

  it('refuse un doublon', async () => {
    await expect(
      reorderSessionExercises(session.id, [ids[0], ids[0], ids[1]]),
    ).rejects.toThrow(/Invalid reorder/);
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
    const b = await addExerciseToSession(session.id, pushUps.id);
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

describe('setSessionBodyweight', () => {
  it('enregistre le poids de corps', async () => {
    const { session } = await startSession();
    const updated = await setSessionBodyweight(session.id, 78.4);

    expect(updated.bodyweightKg).toBe(78.4);
    expect((await db.sessions.get(session.id))!.bodyweightKg).toBe(78.4);
  });

  it('le corrige', async () => {
    const { session } = await startSession({ bodyweightKg: 78 });
    const updated = await setSessionBodyweight(session.id, 77.2);

    expect(updated.bodyweightKg).toBe(77.2);
  });

  it('l’efface plutôt que de stocker une valeur vide', async () => {
    const { session } = await startSession({ bodyweightKg: 78 });
    const updated = await setSessionBodyweight(session.id, undefined);

    expect(updated.bodyweightKg).toBeUndefined();
    expect('bodyweightKg' in (await db.sessions.get(session.id))!).toBe(false);
  });

  it('refuse une valeur aberrante', async () => {
    const { session } = await startSession();
    await expect(setSessionBodyweight(session.id, 900)).rejects.toThrow(SessionValidationError);
    await expect(setSessionBodyweight(session.id, 0)).rejects.toThrow(SessionValidationError);
  });

  it('lève sur une séance inconnue', async () => {
    await expect(setSessionBodyweight('inconnue', 78)).rejects.toThrow(/not found/);
  });
});

describe('updateSessionText', () => {
  it('pose un titre sur une seance deja commencee', async () => {
    const { session } = await startSession();
    const named = await updateSessionText(session.id, { title: 'Push A' });

    expect(named.title).toBe('Push A');
    expect((await db.sessions.get(session.id))?.title).toBe('Push A');
  });

  it('efface un titre passe a undefined', async () => {
    const { session } = await startSession({ title: 'Push A' });
    await updateSessionText(session.id, { title: undefined });

    const stored = await db.sessions.get(session.id);
    expect(stored).toBeDefined();
    expect('title' in stored!).toBe(false);
  });

  it('ne touche pas a ce qui est absent du patch', async () => {
    const { session } = await startSession({ title: 'Push A', notes: 'dos fatigue' });
    await updateSessionText(session.id, { notes: 'mieux' });

    const stored = await db.sessions.get(session.id);
    expect(stored?.title).toBe('Push A');
    expect(stored?.notes).toBe('mieux');
  });

  it('ne deplace ni la date ni les series', async () => {
    // Le contrat de la fonction : elle ne touche qu'au texte. La date a sa
    // propre fonction parce qu'elle propage performedAt.
    const { session } = await startSession();
    await updateSessionText(session.id, { title: 'Push A' });

    const stored = await db.sessions.get(session.id);
    expect(stored?.startedAt).toBe(session.startedAt);
    expect(stored?.date).toBe(session.date);
  });

  it('rejette un titre qui n est pas du texte', async () => {
    const { session } = await startSession();
    await expect(
      updateSessionText(session.id, { title: 42 as unknown as string }),
    ).rejects.toBeInstanceOf(SessionValidationError);
  });

  it('refuse une seance inconnue', async () => {
    await expect(updateSessionText('nope', { title: 'x' })).rejects.toThrow();
  });
});

describe('setSessionExerciseNotes', () => {
  it('note un exercice pour ce jour-la', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);

    const noted = await setSessionExerciseNotes(block.id, 'banc trop haut');
    expect(noted.notes).toBe('banc trop haut');
    expect((await db.sessionExercises.get(block.id))?.notes).toBe('banc trop haut');
  });

  it('efface la note', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id, {
      notes: 'banc trop haut',
    });

    await setSessionExerciseNotes(block.id, undefined);
    const stored = await db.sessionExercises.get(block.id);
    expect(stored).toBeDefined();
    expect('notes' in stored!).toBe(false);
  });

  it('laisse le rang et le rattachement intacts', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);

    await setSessionExerciseNotes(block.id, 'gene epaule');
    const stored = await db.sessionExercises.get(block.id);

    expect(stored?.order).toBe(block.order);
    expect(stored?.sessionId).toBe(session.id);
    expect(stored?.exerciseId).toBe(squat.id);
  });

  it('refuse un bloc inconnu', async () => {
    await expect(setSessionExerciseNotes('nope', 'x')).rejects.toThrow();
  });
});

describe('startSessionFrom', () => {
  /** A finished session laid out with two exercises and one logged set. */
  async function pastSession() {
    const { session } = await startSession();
    const first = await addExerciseToSession(session.id, squat.id, { notes: 'banc trop haut' });
    await addExerciseToSession(session.id, pushUps.id);
    await createSet({ sessionExerciseId: first.id, weightKg: 100, reps: 5, kind: 'work' });
    await endSession(session.id);
    return session;
  }

  it('reprend les exercices, dans le meme ordre', async () => {
    const source = await pastSession();
    const result = await startSessionFrom(source.id);

    expect(result.copied).toBe(2);
    const blocks = await listSessionExercises(result.session.id);
    expect(blocks.map((b) => b.exerciseId)).toEqual([squat.id, pushUps.id]);
  });

  it('ne reprend aucune serie : c est un plan, pas une copie', async () => {
    const source = await pastSession();
    const result = await startSessionFrom(source.id);

    const blocks = await listSessionExercises(result.session.id);
    const counts = await Promise.all(
      blocks.map((b) => db.sets.where('sessionExerciseId').equals(b.id).count()),
    );
    expect(counts).toEqual([0, 0]);
  });

  it('laisse les notes derriere elles', async () => {
    // « banc trop haut » etait vrai ce jour-la, pas d une seance a venir.
    const source = await pastSession();
    const result = await startSessionFrom(source.id);

    const blocks = await listSessionExercises(result.session.id);
    expect(blocks.every((b) => b.notes === undefined)).toBe(true);
  });

  it('ne touche pas a la seance d origine', async () => {
    const source = await pastSession();
    await startSessionFrom(source.id);

    const blocks = await listSessionExercises(source.id);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].notes).toBe('banc trop haut');
    expect(await db.sets.where('sessionId').equals(source.id).count()).toBe(1);
  });

  it('ecarte un exercice archive depuis, et le nomme', async () => {
    const source = await pastSession();
    await archiveExercise(pushUps.id);

    const result = await startSessionFrom(source.id);

    expect(result.copied).toBe(1);
    expect(result.skipped).toEqual([pushUps.name]);
    const blocks = await listSessionExercises(result.session.id);
    expect(blocks.map((b) => b.exerciseId)).toEqual([squat.id]);
  });

  it('ferme la seance restee ouverte, comme un demarrage normal', async () => {
    const source = await pastSession();
    const { session: open } = await startSession();

    const result = await startSessionFrom(source.id);

    expect(result.autoClosed?.id).toBe(open.id);
    expect((await db.sessions.get(open.id))?.endedAt).toBeDefined();
  });

  it('accepte une seance d origine sans exercice', async () => {
    const { session } = await startSession();
    await endSession(session.id);

    const result = await startSessionFrom(session.id);
    expect(result.copied).toBe(0);
    expect(await listSessionExercises(result.session.id)).toHaveLength(0);
  });

  it('refuse une seance inconnue sans rien ouvrir', async () => {
    const before = await db.sessions.count();
    await expect(startSessionFrom('nope')).rejects.toThrow();
    expect(await db.sessions.count()).toBe(before);
  });
});
