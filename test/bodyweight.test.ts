import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { getBodyWeight, listBodyWeights, setBodyWeight } from '../lib/db/bodyweight';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { buildSeedExercises } from '../lib/db/seed';
import { SessionValidationError } from '../lib/db/validation';
import type { Session } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('setBodyWeight', () => {
  it('enregistre le poids d’un jour', async () => {
    await setBodyWeight('2026-08-20', 78.4);
    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(78.4);
  });

  it('remplace au lieu d’empiler', async () => {
    // Se peser deux fois le matin est une correction, pas un second fait.
    await setBodyWeight('2026-08-20', 78.4);
    await setBodyWeight('2026-08-20', 78.1);

    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(78.1);
    expect(await db.bodyweights.count()).toBe(1);
  });

  it('efface quand on passe undefined', async () => {
    await setBodyWeight('2026-08-20', 78.4);
    await setBodyWeight('2026-08-20', undefined);

    expect(await getBodyWeight('2026-08-20')).toBeUndefined();
  });

  it('garde les jours indépendants', async () => {
    await setBodyWeight('2026-08-19', 78);
    await setBodyWeight('2026-08-20', 79);

    expect((await getBodyWeight('2026-08-19'))?.weightKg).toBe(78);
    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(79);
  });

  it('refuse un poids absurde', async () => {
    await expect(setBodyWeight('2026-08-20', 0)).rejects.toBeInstanceOf(SessionValidationError);
    await expect(setBodyWeight('2026-08-20', 900)).rejects.toBeInstanceOf(SessionValidationError);
  });

  it('refuse une date mal formée', async () => {
    // La date est la clé primaire : une clé bancale crée une ligne
    // qu'aucune lecture ne retrouvera jamais.
    await expect(setBodyWeight('20 août', 78)).rejects.toBeInstanceOf(SessionValidationError);
  });
});

describe('listBodyWeights', () => {
  it('rend la fenêtre demandée, bornes incluses, du plus ancien au plus récent', async () => {
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

  it('rend une liste vide hors de toute donnée', async () => {
    await setBodyWeight('2026-08-20', 78);
    expect(await listBodyWeights('2026-01-01', '2026-01-31')).toEqual([]);
  });
});

describe('la séance et le calendrier partagent la même valeur', () => {
  it('la séance ne stocke plus aucun poids de son côté', async () => {
    // C'est l'invariant de tout ce déménagement : une seule source.
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
describe('migration du poids de corps vers sa propre table', () => {
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

  it('reprend le poids porté par une séance', async () => {
    await upgradeFrom([legacySession({ bodyweightKg: 81.5 })]);

    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(81.5);
  });

  it('retire le poids de la séance, pour ne pas laisser de doublon', async () => {
    // Une seconde copie que personne ne lit est une seconde copie que
    // quelqu'un finira par lire par erreur.
    await upgradeFrom([legacySession({ bodyweightKg: 81.5 })]);

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].bodyweightKg).toBeUndefined();
  });

  it('ignore les séances sans poids', async () => {
    await upgradeFrom([legacySession({}), legacySession({ date: '2026-08-21' })]);

    expect(await db.bodyweights.count()).toBe(0);
  });

  it('garde la dernière pesée quand deux séances partagent un jour', async () => {
    await upgradeFrom([
      legacySession({ startedAt: 1_700_000_000_000, bodyweightKg: 80 }),
      legacySession({ startedAt: 1_700_000_900_000, bodyweightKg: 81 }),
    ]);

    expect(await db.bodyweights.count()).toBe(1);
    expect((await getBodyWeight('2026-08-20'))?.weightKg).toBe(81);
  });

  it('laisse une base intacte, et utilisable après coup', async () => {
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
