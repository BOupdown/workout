import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { getBodyWeight, listBodyWeights, setBodyWeight } from '../lib/db/bodyweight';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { buildSeedExercises } from '../lib/db/seed';
import { BodyWeightValidationError } from '../lib/db/validation';
import type { Session } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('setBodyWeight', () => {
  it('records the weight of a day', async () => {
    await setBodyWeight('2026-08-20', 78.4);
    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(78.4);
  });

  it('remplace au lieu d’empiler', async () => {
    // Weighing yourself twice in one morning is a correction, not a second
    // fact.
    await setBodyWeight('2026-08-20', 78.4);
    await setBodyWeight('2026-08-20', 78.1);

    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(78.1);
    expect(await db.bodyweights.count()).toBe(1);
  });

  it('clears when handed undefined', async () => {
    await setBodyWeight('2026-08-20', 78.4);
    await setBodyWeight('2026-08-20', undefined);

    expect(await getBodyWeight('2026-08-20')).toBeUndefined();
  });

  it('keeps the days independent', async () => {
    await setBodyWeight('2026-08-19', 78);
    await setBodyWeight('2026-08-20', 79);

    expect((await getBodyWeight('2026-08-19'))?.weightKg).toBe(78);
    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(79);
  });

  it('refuses an absurd weight', async () => {
    await expect(setBodyWeight('2026-08-20', 0)).rejects.toBeInstanceOf(BodyWeightValidationError);
    await expect(setBodyWeight('2026-08-20', 900)).rejects.toBeInstanceOf(BodyWeightValidationError);
  });

  it('refuses a malformed date', async () => {
    // The date is the primary key: a shaky key creates a row that no read will
    // ever find again.
    await expect(setBodyWeight('20 August', 78)).rejects.toBeInstanceOf(BodyWeightValidationError);
  });
});

describe('listBodyWeights', () => {
  it('returns the window asked for, ends included, oldest first', async () => {
    await setBodyWeight('2026-08-17', 77);
    await setBodyWeight('2026-08-18', 78);
    await setBodyWeight('2026-08-19', 79);
    await setBodyWeight('2026-08-25', 80);

    const window = await listBodyWeights('2026-08-17', '2026-08-19');
    expect(window.map((entry) => entry.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
  });

  it('returns an empty list where there is no data', async () => {
    await setBodyWeight('2026-08-20', 78);
    expect(await listBodyWeights('2026-01-01', '2026-01-31')).toEqual([]);
  });
});

describe('the session and the calendar share one value', () => {
  it('the session no longer stores a weight of its own', async () => {
    // The invariant behind that whole move: a single source.
    const { session } = await startSession();
    await setBodyWeight(session.date, 80);

    const stored = await db.sessions.get(session.id);
    expect(stored).toBeDefined();
    expect(stored!.bodyweightKg).toBeUndefined();
    expect((await getBodyWeight(session.date))?.weightKg).toBe(80);
  });
});

/**
 * The v2 → v3 upgrade, exercised for real.
 *
 * A migration is the one piece of code that runs once, on data you cannot
 * recreate, on a device you will never see. Testing it against a database
 * actually shaped like the old one is the only way to know it works — a fresh
 * database opens straight at v3 and never runs the upgrade at all.
 */
describe('migrating bodyweight into its own table', () => {
  /** Rebuilds a v2 database, populates it, then lets the app open it. */
  async function upgradeFrom(sessions: Session[]) {
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

    await legacy.open();
    // The catalogue too: a real v2 database has one, and the upgrade must not
    // disturb it.
    await legacy.table('exercises').bulkAdd(buildSeedExercises());
    await legacy.table<Session, string>('sessions').bulkAdd(sessions);
    legacy.close();

    await db.open();
  }

  const legacySession = (over: Partial<Session>): Session =>
    ({
      id: Math.random().toString(36).slice(2),
      startedAt: 1_700_000_000_000,
      date: '2026-08-20',
      createdAt: 1_700_000_000_000,
      ...over,
    }) as Session;

  it('carries over the weight a session was holding', async () => {
    await upgradeFrom([legacySession({ bodyweightKg: 81.5 })]);

    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(81.5);
  });

  it('removes the weight from the session, leaving no duplicate', async () => {
    // A second copy nobody reads is a second copy somebody will eventually
    // read by mistake.
    await upgradeFrom([legacySession({ bodyweightKg: 81.5 })]);

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].bodyweightKg).toBeUndefined();
  });

  it('ignores the sessions carrying no weight', async () => {
    await upgradeFrom([legacySession({}), legacySession({ date: '2026-08-21' })]);

    expect(await db.bodyweights.count()).toBe(0);
  });

  it('keeps the later weigh-in when two sessions share a day', async () => {
    await upgradeFrom([
      legacySession({ startedAt: 1_700_000_000_000, bodyweightKg: 80 }),
      legacySession({ startedAt: 1_700_000_900_000, bodyweightKg: 81 }),
    ]);

    expect(await db.bodyweights.count()).toBe(1);
    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(81);
  });

  it('leaves the database intact, and usable afterwards', async () => {
    await upgradeFrom([
      legacySession({ date: '2026-08-19', bodyweightKg: 79 }),
      legacySession({ date: '2026-08-20', bodyweightKg: 80 }),
    ]);

    const squat = await exerciseByKey('squat');
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);

    expect(await db.bodyweights.count()).toBe(2);
    expect(await db.sessions.count()).toBe(3);
    // The catalogue crossed the upgrade untouched.
    expect(await db.exercises.count()).toBe(buildSeedExercises().length);
  });
});
