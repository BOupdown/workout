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
import { db } from '../lib/db/db';
import { createExercise } from '../lib/db/exercises';
import { createSet } from '../lib/db/sets';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import type { Exercise, SetEntry } from '../lib/db/types';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;

/** Une base représentative : catalogue, exercice perso, deux séances, séries. */
async function seedRealData() {
  await createExercise({ name: 'Face pull', loadType: 'external', metric: 'reps' });

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

  it('produit un objet sérialisable tel quel', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    // Un aller-retour JSON ne doit rien perdre : pas de Date, pas de Map.
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup);
  });

  it('emporte aussi les exercices personnalisés', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    expect(backup.exercises.some((e) => e.isCustom && e.name === 'Face pull')).toBe(true);
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

  it('rejette un fichier étranger', () => {
    expect(() => readBackup({ ...valid(), format: 'autre-app' })).toThrow(/not a Workout backup/);
  });

  it('rejette une version inconnue en la nommant', () => {
    expect(() => readBackup({ ...valid(), version: 99 })).toThrow(/version 99/);
  });

  it('rejette une sauvegarde amputée d’une table', () => {
    const withoutSets = { ...valid() } as Record<string, unknown>;
    delete withoutSets.sets;
    expect(() => readBackup(withoutSets)).toThrow(/sets/);
  });
});

describe('parseBackup', () => {
  it('lit une sauvegarde exportée', async () => {
    const backup = await exportDatabase();
    expect(parseBackup(JSON.stringify(backup)).format).toBe(BACKUP_FORMAT);
  });

  it('rejette du JSON invalide avec un message clair', () => {
    expect(() => parseBackup('{ pas du json')).toThrow(/valid JSON/);
  });
});

describe('importDatabase', () => {
  it('restaure une base vidée à l’identique', async () => {
    await seedRealData();
    const backup = await exportDatabase();
    const before = {
      exercises: await db.exercises.count(),
      sessions: await db.sessions.count(),
      sets: await db.sets.count(),
    };

    // Simule un nouvel appareil : base neuve, seulement le catalogue livré.
    await resetDatabase();
    expect(await db.sessions.count()).toBe(0);

    const summary = await importDatabase(backup);

    expect(await db.exercises.count()).toBe(before.exercises);
    expect(await db.sessions.count()).toBe(before.sessions);
    expect(await db.sets.count()).toBe(before.sets);
    expect(summary.sets).toBe(before.sets);
  });

  it('conserve les valeurs des séries, pas seulement leur nombre', async () => {
    await seedRealData();
    const backup = await exportDatabase();
    await resetDatabase();
    await importDatabase(backup);

    const sets = await db.sets.orderBy('sessionId').toArray();
    expect(sets.map((s) => s.weightKg).sort()).toEqual(backup.sets.map((s) => s.weightKg).sort());
    expect(sets.filter((s) => s.kind === 'warmup')).toHaveLength(1);
  });

  it('remplace les données existantes au lieu de les cumuler', async () => {
    await seedRealData();
    const backup = await exportDatabase();

    // On réimporte par-dessus une base déjà pleine.
    await importDatabase(backup);

    expect(await db.sessions.count()).toBe(backup.sessions.length);
    expect(await db.sets.count()).toBe(backup.sets.length);
  });

  it('laisse la base intacte quand une ligne est invalide', async () => {
    await seedRealData();
    const backup = await exportDatabase();
    const before = await db.sets.count();

    // Une série sans `sessionId` : refusée par le hook structurel.
    const corrupted: BackupFile = {
      ...backup,
      sets: [...backup.sets, { ...backup.sets[0], id: 'corrompue', sessionId: '' } as SetEntry],
    };

    await expect(importDatabase(corrupted)).rejects.toThrow();

    // Le `clear()` doit avoir été annulé avec le reste de la transaction.
    expect(await db.sets.count()).toBe(before);
    expect(await db.sessions.count()).toBe(backup.sessions.length);
  });

  it('applique la même validation qu’à la saisie', async () => {
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
  it('résume ce que contient la sauvegarde', async () => {
    await seedRealData();
    const summary = summarise(await exportDatabase());

    expect(summary.sessions).toBe(2);
    expect(summary.sets).toBe(4);
  });

  it('date le nom de fichier', () => {
    expect(backupFileName(new Date(2026, 7, 16).getTime())).toBe('workout-2026-08-16.json');
  });
});
