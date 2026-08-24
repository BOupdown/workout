import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupFormatError,
  backupFileName,
  exportDatabase,
  importDatabase,
  parseBackup,
  readBackup,
  summarise,
  type BackupFile,
} from '../lib/db/backup';
import { addMissingSeedExercises, db } from '../lib/db/db';
import { getBodyWeight, setBodyWeight } from '../lib/db/bodyweight';
import { createExercise, deleteExercise } from '../lib/db/exercises';
import { createSet } from '../lib/db/sets';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import type { Exercise, SetEntry } from '../lib/db/types';
import { exerciseByKey, referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;

/** A representative database: catalogue, custom exercise, two sessions, sets. */
async function seedRealData() {
  await createExercise({ name: 'Sandbag carry', loadType: 'external', metric: 'reps' });

  const older = Date.parse('2026-08-09T09:00:00Z');
  const first = await startSession({ startedAt: older, bodyweightKg: 78 });
  const blockA = await addExerciseToSession(first.session.id, squat.id);
  await createSet({ sessionExerciseId: blockA.id, kind: 'warmup', weightKg: 40, reps: 10 });
  await createSet({ sessionExerciseId: blockA.id, weightKg: 95, reps: 5 });
  await endSession(first.session.id, older + 3_600_000);

  const second = await startSession({ startedAt: Date.parse('2026-08-16T09:00:00Z') });
  const blockB = await addExerciseToSession(second.session.id, squat.id);
  const blockC = await addExerciseToSession(second.session.id, pushUps.id);
  await createSet({ sessionExerciseId: blockB.id, weightKg: 100, reps: 5 });
  await createSet({ sessionExerciseId: blockC.id, reps: 25 });
}

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps } = await referenceExercises());
});

describe('exportDatabase', () => {
  it('emporte les quatre tables', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exercises.length).toBeGreaterThan(23);
    expect(backup.sessions).toHaveLength(2);
    expect(backup.sessionExercises).toHaveLength(3);
    expect(backup.sets).toHaveLength(4);
  });

  it('produces an object that serialises as it stands', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    // A JSON round-trip must lose nothing: no Date, no Map.
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup);
  });

  it('takes the custom exercises along too', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    expect(backup.exercises.some((e) => e.isCustom && e.name === 'Sandbag carry')).toBe(true);
  });
});

describe('readBackup', () => {
  const valid = (): BackupFile => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 1,
    exercises: [],
    sessions: [],
    sessionExercises: [],
    sets: [],
  });

  it('accepte une enveloppe correcte', () => {
    expect(readBackup(valid())).toEqual(valid());
  });

  it.each([null, 42, 'texte', []])('rejette %s', (value) => {
    expect(() => readBackup(value)).toThrow(BackupFormatError);
  });

  it('rejects a foreign file', () => {
    expect(() => readBackup({ ...valid(), format: 'autre-app' })).toThrow(/not a Workout backup/);
  });

  it('rejects an unknown version, naming it', () => {
    expect(() => readBackup({ ...valid(), version: 99 })).toThrow(/version 99/);
  });

  it('rejects a backup missing a table', () => {
    const withoutSets = { ...valid() } as Record<string, unknown>;
    delete withoutSets.sets;
    expect(() => readBackup(withoutSets)).toThrow(/sets/);
  });
});

describe('parseBackup', () => {
  it('reads a backup it exported', async () => {
    const backup = await exportDatabase();
    expect(parseBackup(JSON.stringify(backup)).format).toBe(BACKUP_FORMAT);
  });

  it('rejects invalid JSON with a clear message', () => {
    expect(() => parseBackup('{ not json')).toThrow(/valid JSON/);
  });
});

describe('importDatabase', () => {
  it('restores an emptied database exactly as it was', async () => {
    await seedRealData();
    const backup = await exportDatabase();
    const before = {
      exercises: await db.exercises.count(),
      sessions: await db.sessions.count(),
      sets: await db.sets.count(),
    };

    // Simulates a new device: a fresh database holding only the shipped
    // catalogue.
    await resetDatabase();
    expect(await db.sessions.count()).toBe(0);

    const summary = await importDatabase(backup);

    expect(await db.exercises.count()).toBe(before.exercises);
    expect(await db.sessions.count()).toBe(before.sessions);
    expect(await db.sets.count()).toBe(before.sets);
    expect(summary.sets).toBe(before.sets);
  });

  it('keeps the values of the sets, not merely how many there are', async () => {
    await seedRealData();
    const backup = await exportDatabase();
    await resetDatabase();
    await importDatabase(backup);

    const sets = await db.sets.orderBy('sessionId').toArray();
    expect(sets.map((s) => s.weightKg).sort()).toEqual(backup.sets.map((s) => s.weightKg).sort());
    expect(sets.filter((s) => s.kind === 'warmup')).toHaveLength(1);
  });

  it('replaces the existing data instead of adding to it', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    // Importing again on top of a database that is already full.
    await importDatabase(backup);

    expect(await db.sessions.count()).toBe(backup.sessions.length);
    expect(await db.sets.count()).toBe(backup.sets.length);
  });

  it('leaves the database intact when one row is invalid', async () => {
    await seedRealData();
    const backup = await exportDatabase();
    const before = await db.sets.count();

    // A set with no `sessionId`: refused by the structural hook.
    const corrupted: BackupFile = {
      ...backup,
      sets: [...backup.sets, { ...backup.sets[0], id: 'corrompue', sessionId: '' } as SetEntry],
    };

    await expect(importDatabase(corrupted)).rejects.toThrow();

    // The `clear()` has to have been rolled back with the rest of the
    // transaction.
    expect(await db.sets.count()).toBe(before);
    expect(await db.sessions.count()).toBe(backup.sessions.length);
  });

  it('applies the same validation as data entry', async () => {
    const backup = await exportDatabase();
    const corrupted: BackupFile = {
      ...backup,
      exercises: [
        ...backup.exercises,
        { ...backup.exercises[0], id: 'incoherent', name: 'Test', nameKey: 'autre chose' },
      ],
    };

    await expect(importDatabase(corrupted)).rejects.toThrow();
  });
});

describe('summarise & backupFileName', () => {
  it('sums up what the backup holds', async () => {
    await seedRealData();
    const summary = summarise(await exportDatabase());

    expect(summary.sessions).toBe(2);
    expect(summary.sets).toBe(4);
  });

  it('dates the file name', () => {
    expect(backupFileName(new Date(2026, 7, 16).getTime())).toBe('workout-2026-08-16.json');
  });
});

describe('bodyweight inside backups', () => {
  it('exporte la timeline', async () => {
    await setBodyWeight('2026-08-20', 78.4);

    const backup = await exportDatabase();
    expect(backup.bodyweights).toEqual([
      expect.objectContaining({ date: '2026-08-20', weightKg: 78.4 }),
    ]);
  });

  it('reads back what it wrote', async () => {
    await setBodyWeight('2026-08-19', 77);
    await setBodyWeight('2026-08-20', 78);
    const backup = await exportDatabase();

    await setBodyWeight('2026-08-20', 999 as unknown as number).catch(() => {});
    await db.bodyweights.clear();
    await importDatabase(backup);

    expect(await db.bodyweights.count()).toBe(2);
    expect((await getBodyWeight('2026-08-19'))?.weightKg).toBe(77);
  });

  it('accepts a file written before the timeline existed', async () => {
    // The field is absent: bumping the format version would have made every
    // backup already in people's hands unreadable.
    const legacy = await exportDatabase();
    delete legacy.bodyweights;

    await expect(importDatabase(legacy)).resolves.toBeDefined();
  });

  it('recovers the weights the old sessions were carrying', async () => {
    // Restoring an old backup must not lose a year of weigh-ins.
    const backup = await exportDatabase();
    delete backup.bodyweights;
    backup.sessions = [
      {
        id: 'old-1',
        startedAt: 1_700_000_000_000,
        date: '2026-08-18',
        createdAt: 1_700_000_000_000,
        bodyweightKg: 76.5,
      },
    ] as typeof backup.sessions;

    await importDatabase(backup);

    expect((await getBodyWeight('2026-08-18'))?.weightKg).toBe(76.5);
  });

  it('refuses a field that is present but unreadable', async () => {
    const backup = await exportDatabase();
    const broken = JSON.stringify({ ...backup, bodyweights: 'nope' });

    expect(() => parseBackup(broken)).toThrow(BackupFormatError);
  });
});

describe('sauvegarde — pierres tombales', () => {
  beforeEach(resetDatabase);

  it('leaves a deleted exercise deleted on a fresh device', async () => {
    // The exact scenario backups exist for: data cleared, reinstall, restore.
    // Without the tombstones in the file, the next version to grow the
    // catalogue would hand everything back.
    const jumpRope = await exerciseByKey('jump rope');
    await deleteExercise(jumpRope.id);

    const backup = await exportDatabase();

    await resetDatabase();
    await importDatabase(backup);

    await db.transaction('rw', db.exercises, db.retiredExercises, async (tx) => {
      await addMissingSeedExercises(tx);
    });

    expect(await db.exercises.where('nameKey').equals('jump rope').count()).toBe(0);
  });

  it('leaves the tombstones on the phone alone for a file that ignores them', async () => {
    // Absent does not mean "none": a file written before they existed says
    // nothing about them, and clearing them would hand the exercise back.
    const jumpRope = await exerciseByKey('jump rope');
    const legacy = await exportDatabase();
    delete legacy.retiredExercises;

    await deleteExercise(jumpRope.id);
    await importDatabase(legacy);

    expect(await db.retiredExercises.count()).toBe(1);
  });
});

describe('backup — references', () => {
  beforeEach(resetDatabase);

  /** A complete session: one block, one set. */
  async function oneLoggedSet() {
    const { squat } = await referenceExercises();
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    return { squat, session, block };
  }

  it('refuses a file whose set points at nothing', async () => {
    const { squat } = await oneLoggedSet();

    const backup = await exportDatabase();
    backup.exercises = backup.exercises.filter((exercise) => exercise.id !== squat.id);

    await expect(importDatabase(backup)).rejects.toThrow(BackupFormatError);
  });

  it('touches nothing before refusing', async () => {
    // The import clears before it writes: a file wrongly accepted would take
    // the history already there with it. The check therefore has to come before
    // the transaction.
    const { squat } = await oneLoggedSet();

    const backup = await exportDatabase();
    backup.sessionExercises = [];

    await expect(importDatabase(backup)).rejects.toThrow(BackupFormatError);

    expect(await db.sets.count()).toBe(1);
    expect(await db.sessionExercises.count()).toBe(1);
    expect(await db.exercises.get(squat.id)).toBeDefined();
  });

  it('says how many rows dangle, not which ones', async () => {
    const { session } = await oneLoggedSet();

    const backup = await exportDatabase();
    backup.sessions = backup.sessions.filter((row) => row.id !== session.id);

    await expect(importDatabase(backup)).rejects.toThrow(/1 set/);
  });

  it('accepts a whole backup', async () => {
    await oneLoggedSet();
    const backup = await exportDatabase();

    await expect(importDatabase(backup)).resolves.toBeDefined();
  });
});
