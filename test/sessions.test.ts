import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { toLocalDate } from '../lib/db/keys';
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
  it('derives the local day and the id', async () => {
    const startedAt = new Date(2026, 7, 16, 19, 30).getTime();
    const { session } = await startSession({ startedAt });

    expect(session.date).toBe('2026-08-16');
    expect(session.id).toBeTruthy();
    expect(session.endedAt).toBeUndefined();
  });

  it('accepts the optional fields without materialising the absent ones', async () => {
    const { session } = await startSession({ title: 'Push A', bodyweightKg: 78 });

    expect(session.title).toBe('Push A');
    expect(session.bodyweightKg).toBe(78);
    expect('notes' in session).toBe(false);
  });

  it('refuses a bodyweight that makes no sense', async () => {
    await expect(startSession({ bodyweightKg: 900 })).rejects.toThrow(SessionValidationError);
  });
});

describe('a session left open', () => {
  it('closes the previous one by itself, and says so', async () => {
    const first = await startSession({ startedAt: Date.parse('2026-08-09T09:00:00Z') });
    const second = await startSession({ startedAt: Date.parse('2026-08-16T09:00:00Z') });

    expect(second.autoClosed?.id).toBe(first.session.id);
    expect(second.autoClosed?.endedAt).toBeDefined();

    const reloaded = await db.sessions.get(first.session.id);
    expect(reloaded!.endedAt).toBeDefined();
  });

  it('closes at the last set logged, not at "now"', async () => {
    const startedAt = Date.parse('2026-08-09T09:00:00Z');
    const { session } = await startSession({ startedAt });
    const block = await addExerciseToSession(session.id, squat.id);
    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { autoClosed } = await startSession();

    // Without `loggedAt`, a session forgotten a week ago would report a
    // duration of seven days.
    expect(autoClosed!.endedAt).toBe(set.loggedAt);
  });

  it('falls back to startedAt when the session holds no set', async () => {
    const startedAt = Date.parse('2026-08-09T09:00:00Z');
    const { session } = await startSession({ startedAt });

    const { autoClosed } = await startSession();
    expect(autoClosed!.endedAt).toBe(session.startedAt);
  });

  it('never leaves two sessions open', async () => {
    await startSession();
    await startSession();
    await startSession();

    const open = await db.sessions.filter((s) => s.endedAt === undefined).toArray();
    expect(open).toHaveLength(1);
  });

  it('opens no stray session when there was nothing to close', async () => {
    const { autoClosed } = await startSession();
    expect(autoClosed).toBeUndefined();
  });
});

describe('getActiveSession', () => {
  it('returns nothing from an empty database', async () => {
    expect(await getActiveSession()).toBeUndefined();
  });

  it('finds the session in progress', async () => {
    const { session } = await startSession();
    expect((await getActiveSession())?.id).toBe(session.id);
  });

  it('does not close the session it finds', async () => {
    // The key point of the design: reopening the app between two sets has to
    // resume the session, not end it.
    await startSession();
    await getActiveSession();

    expect((await getActiveSession())?.endedAt).toBeUndefined();
  });

  it('returns nothing once it is closed', async () => {
    const { session } = await startSession();
    await endSession(session.id);

    expect(await getActiveSession()).toBeUndefined();
  });
});

describe('endSession', () => {
  it('closes the session', async () => {
    const { session } = await startSession();
    const ended = await endSession(session.id);

    expect(ended.endedAt).toBeDefined();
    expect((await db.sessions.get(session.id))!.endedAt).toBeDefined();
  });

  it('is idempotent — a double press must not raise an error', async () => {
    const { session } = await startSession();
    const first = await endSession(session.id);
    const second = await endSession(session.id);

    expect(second.endedAt).toBe(first.endedAt);
  });

  it('refuses an end that falls before the start', async () => {
    const startedAt = Date.parse('2026-08-16T09:00:00Z');
    const { session } = await startSession({ startedAt });

    await expect(endSession(session.id, startedAt - 1000)).rejects.toThrow(
      SessionValidationError,
    );
  });

  it('throws for a session it does not know', async () => {
    await expect(endSession('inconnue')).rejects.toThrow(/not found/);
  });

  it('closes a session dated in the future all the same', async () => {
    // One mistyped year on a phone and the start is out of the clock's reach.
    // With no bound, "Finish" would be refused every time — showing nothing —
    // and the session would stay open for good.
    const { session } = await startSession();
    const nextYear = toLocalDate(Date.now() + 365 * 86_400_000);
    await updateSessionDate(session.id, nextYear);

    const ended = await endSession(session.id);

    const stored = await db.sessions.get(session.id);
    expect(stored?.endedAt).toBeDefined();
    expect(ended.endedAt).toBe(stored!.startedAt);
  });
});

describe('updateSessionDate', () => {
  it('propagates performedAt to every set of the session', async () => {
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 0).getTime() });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const updated = await updateSessionDate(session.id, '2026-08-15');

    const sets = await db.sets.where('sessionId').equals(session.id).toArray();
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => s.performedAt === updated.startedAt)).toBe(true);
  });

  it('keeps the time of day', async () => {
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 30).getTime() });
    const updated = await updateSessionDate(session.id, '2026-08-15');

    const moved = new Date(updated.startedAt);
    expect(updated.date).toBe('2026-08-15');
    expect(moved.getHours()).toBe(19);
    expect(moved.getMinutes()).toBe(30);
  });

  it('shifts endedAt by the same gap', async () => {
    const startedAt = new Date(2026, 7, 16, 19, 0).getTime();
    const { session } = await startSession({ startedAt });
    await endSession(session.id, startedAt + 3_600_000);

    const updated = await updateSessionDate(session.id, '2026-08-15');
    expect(updated.endedAt! - updated.startedAt).toBe(3_600_000);
  });

  it('keeps the per-exercise history consistent after the move', async () => {
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 0).getTime() });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await updateSessionDate(session.id, '2026-01-05');

    const set = (await db.sets.where('sessionId').equals(session.id).toArray())[0];
    const reloaded = (await db.sessions.get(session.id))!;
    expect(set.performedAt).toBe(reloaded.startedAt);
  });

  it('refuses a day that does not exist', async () => {
    const { session } = await startSession();
    await expect(updateSessionDate(session.id, '2026-02-30')).rejects.toThrow(RangeError);
  });
});

describe('addExerciseToSession', () => {
  it('numbers the blocks in the order they are added', async () => {
    const { session } = await startSession();
    const a = await addExerciseToSession(session.id, squat.id);
    const b = await addExerciseToSession(session.id, pushUps.id);

    expect([a.order, b.order]).toEqual([0, 1]);
  });

  it('accepts the same exercise twice within one session', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await addExerciseToSession(session.id, squat.id);

    expect(await listSessionExercises(session.id)).toHaveLength(2);
  });

  it('refuses an archived exercise', async () => {
    await db.exercises.update(plank.id, { archivedAt: Date.now() });
    const { session } = await startSession();

    await expect(addExerciseToSession(session.id, plank.id)).rejects.toThrow(
      SessionExerciseValidationError,
    );
  });

  it('throws for a session or an exercise it does not know', async () => {
    const { session } = await startSession();
    await expect(addExerciseToSession('inconnue', squat.id)).rejects.toThrow(/not found/);
    await expect(addExerciseToSession(session.id, 'inconnu')).rejects.toThrow(/not found/);
  });
});

describe('removeExerciseFromSession', () => {
  it('removes an empty block without ceremony', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);

    const { deletedSets } = await removeExerciseFromSession(block.id);

    expect(deletedSets).toBe(0);
    expect(await listSessionExercises(session.id)).toHaveLength(0);
  });

  it('refuses to remove a block holding sets', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await expect(removeExerciseFromSession(block.id)).rejects.toThrow(
      SessionExerciseNotEmptyError,
    );
    expect(await listSessionExercises(session.id)).toHaveLength(1);
  });

  it('carries the number of sets, so the UI can confirm', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    await removeExerciseFromSession(block.id).then(
      () => expect.unreachable('the removal should have been refused'),
      (err: SessionExerciseNotEmptyError) => {
        expect(err.setCount).toBe(2);
        expect(err.sessionExerciseId).toBe(block.id);
      },
    );
  });

  it('removes the block and its sets when forced', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { deletedSets } = await removeExerciseFromSession(block.id, { force: true });

    expect(deletedSets).toBe(2);
    expect(await listSessionExercises(session.id)).toHaveLength(0);
    expect(await db.sets.where('sessionExerciseId').equals(block.id).count()).toBe(0);
  });

  it('leaves the other blocks of the session alone', async () => {
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

  it('renumbers to 0…n-1 in the order asked for', async () => {
    const reordered = await reorderSessionExercises(session.id, [ids[2], ids[0], ids[1]]);

    expect(reordered.map((b) => b.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(reordered.map((b) => b.order)).toEqual([0, 1, 2]);
  });

  it('refuse un ordre partiel', async () => {
    await expect(reorderSessionExercises(session.id, [ids[0], ids[1]])).rejects.toThrow(
      /Invalid reorder/,
    );
  });

  it('refuses an id that belongs to another session', async () => {
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

  it('leaves the order intact when the reordering is refused', async () => {
    await reorderSessionExercises(session.id, [ids[0], ids[1]]).catch(() => {});

    const blocks = await listSessionExercises(session.id);
    expect(blocks.map((b) => b.id)).toEqual(ids);
  });
});

describe('deleteSession — cascade', () => {
  it('deletes the session, its blocks and its sets', async () => {
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

  it('leaves the other sessions alone', async () => {
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
  it('records the bodyweight', async () => {
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

  it('clears it rather than storing an empty value', async () => {
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

  it('throws for a session it does not know', async () => {
    await expect(setSessionBodyweight('inconnue', 78)).rejects.toThrow(/not found/);
  });
});

describe('updateSessionText', () => {
  it('puts a title on a session already under way', async () => {
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

  it('leaves alone what the patch does not carry', async () => {
    const { session } = await startSession({ title: 'Push A', notes: 'dos fatigue' });
    await updateSessionText(session.id, { notes: 'mieux' });

    const stored = await db.sessions.get(session.id);
    expect(stored?.title).toBe('Push A');
    expect(stored?.notes).toBe('mieux');
  });

  it('moves neither the date nor the sets', async () => {
    // The function's contract: it touches the text and nothing else. The date
    // has a function of its own because it propagates performedAt.
    const { session } = await startSession();
    await updateSessionText(session.id, { title: 'Push A' });

    const stored = await db.sessions.get(session.id);
    expect(stored?.startedAt).toBe(session.startedAt);
    expect(stored?.date).toBe(session.date);
  });

  it('rejects a title that is not text', async () => {
    const { session } = await startSession();
    await expect(
      updateSessionText(session.id, { title: 42 as unknown as string }),
    ).rejects.toBeInstanceOf(SessionValidationError);
  });

  it('refuses a session it does not know', async () => {
    await expect(updateSessionText('nope', { title: 'x' })).rejects.toThrow();
  });
});

describe('setSessionExerciseNotes', () => {
  it('notes an exercise for that day', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);

    const noted = await setSessionExerciseNotes(block.id, 'bench too high');
    expect(noted.notes).toBe('bench too high');
    expect((await db.sessionExercises.get(block.id))?.notes).toBe('bench too high');
  });

  it('efface la note', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id, {
      notes: 'bench too high',
    });

    await setSessionExerciseNotes(block.id, undefined);
    const stored = await db.sessionExercises.get(block.id);
    expect(stored).toBeDefined();
    expect('notes' in stored!).toBe(false);
  });

  it('leaves the rank and the attachment intact', async () => {
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

  it('carries the exercises over, in the same order', async () => {
    const source = await pastSession();
    const result = await startSessionFrom(source.id);

    expect(result.copied).toBe(2);
    const blocks = await listSessionExercises(result.session.id);
    expect(blocks.map((b) => b.exerciseId)).toEqual([squat.id, pushUps.id]);
  });

  it('carries no set over: it is a plan, not a copy', async () => {
    const source = await pastSession();
    const result = await startSessionFrom(source.id);

    const blocks = await listSessionExercises(result.session.id);
    const counts = await Promise.all(
      blocks.map((b) => db.sets.where('sessionExerciseId').equals(b.id).count()),
    );
    expect(counts).toEqual([0, 0]);
  });

  it('leaves the notes behind', async () => {
    // "bench too high" was true that day, not of a session still to come.
    const source = await pastSession();
    const result = await startSessionFrom(source.id);

    const blocks = await listSessionExercises(result.session.id);
    expect(blocks.every((b) => b.notes === undefined)).toBe(true);
  });

  it('leaves the original session alone', async () => {
    const source = await pastSession();
    await startSessionFrom(source.id);

    const blocks = await listSessionExercises(source.id);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].notes).toBe('banc trop haut');
    expect(await db.sets.where('sessionId').equals(source.id).count()).toBe(1);
  });

  it('sets aside an exercise archived since, and names it', async () => {
    const source = await pastSession();
    await archiveExercise(pushUps.id);

    const result = await startSessionFrom(source.id);

    expect(result.copied).toBe(1);
    expect(result.skipped).toEqual([pushUps.name]);
    const blocks = await listSessionExercises(result.session.id);
    expect(blocks.map((b) => b.exerciseId)).toEqual([squat.id]);
  });

  it('closes the session left open, as a normal start would', async () => {
    const source = await pastSession();
    const { session: open } = await startSession();

    const result = await startSessionFrom(source.id);

    expect(result.autoClosed?.id).toBe(open.id);
    expect((await db.sessions.get(open.id))?.endedAt).toBeDefined();
  });

  it('accepts an original session holding no exercise', async () => {
    const { session } = await startSession();
    await endSession(session.id);

    const result = await startSessionFrom(session.id);
    expect(result.copied).toBe(0);
    expect(await listSessionExercises(result.session.id)).toHaveLength(0);
  });

  it('refuses a session it does not know, opening nothing', async () => {
    const before = await db.sessions.count();
    await expect(startSessionFrom('nope')).rejects.toThrow();
    expect(await db.sessions.count()).toBe(before);
  });
});
