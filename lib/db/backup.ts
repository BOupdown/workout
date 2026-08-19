/**
 * Backup and restore of the whole database.
 *
 * With no backend this is the **only real guarantee** against data loss:
 * `navigator.storage.persist()` and installing reduce the risk of eviction,
 * they do not remove it. Clearing site data stays irreversible, and a file the
 * user holds does not.
 *
 * Restoring **replaces** everything, it does not merge. Merging would collide
 * with the unique `&nameKey` index: the shipped catalogue exists on both sides
 * with different ids but the same normalised names. Reconciling two devices is
 * a synchronisation problem, not a backup one, and it needs a server.
 */

import { db } from './db';
import type { Exercise, Session, SessionExercise, SetEntry, Timestamp } from './types';

export const BACKUP_FORMAT = 'workout-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: Timestamp;
  exercises: Exercise[];
  sessions: Session[];
  sessionExercises: SessionExercise[];
  sets: SetEntry[];
}

export interface BackupSummary {
  exercises: number;
  sessions: number;
  sets: number;
  exportedAt: Timestamp;
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/** A complete snapshot of the database, serialisable to JSON as is. */
export async function exportDatabase(): Promise<BackupFile> {
  return db.transaction(
    'r',
    db.exercises,
    db.sessions,
    db.sessionExercises,
    db.sets,
    async () => {
      const [exercises, sessions, sessionExercises, sets] = await Promise.all([
        db.exercises.toArray(),
        db.sessions.toArray(),
        db.sessionExercises.toArray(),
        db.sets.toArray(),
      ]);

      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: Date.now(),
        exercises,
        sessions,
        sessionExercises,
        sets,
      };
    },
  );
}

export function summarise(backup: BackupFile): BackupSummary {
  return {
    exercises: backup.exercises.length,
    sessions: backup.sessions.length,
    sets: backup.sets.length,
    exportedAt: backup.exportedAt,
  };
}

const TABLES = ['exercises', 'sessions', 'sessionExercises', 'sets'] as const;

/**
 * Checks the envelope **without writing anything**, so a foreign file can be
 * refused before touching existing data.
 *
 * Row contents are not checked here: Dexie's structural hooks handle that on
 * write, with the same rules as data entry. A backup therefore cannot
 * reintroduce invalid data.
 */
export function readBackup(value: unknown): BackupFile {
  if (typeof value !== 'object' || value === null) {
    throw new BackupFormatError('This file is not a Workout backup.');
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('This file is not a Workout backup.');
  }

  if (candidate.version !== BACKUP_VERSION) {
    throw new BackupFormatError(
      `Backup is version ${String(candidate.version)}; this app reads version ${BACKUP_VERSION}.`,
    );
  }

  for (const table of TABLES) {
    if (!Array.isArray(candidate[table])) {
      throw new BackupFormatError(`Incomplete backup: ${table} is missing or unreadable.`);
    }
  }

  return candidate as unknown as BackupFile;
}

/** Parses a JSON string and checks its envelope. */
export function parseBackup(json: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupFormatError('Unreadable file: this is not valid JSON.');
  }
  return readBackup(parsed);
}

/**
 * Replaces the database contents with the backup's.
 *
 * Everything happens in **one transaction**: if a row is refused by the
 * validation, nothing is written and existing data is untouched. A corrupted
 * backup therefore cannot destroy what is already there.
 */
export async function importDatabase(backup: BackupFile): Promise<BackupSummary> {
  await db.transaction('rw', db.exercises, db.sessions, db.sessionExercises, db.sets, async () => {
    await Promise.all([
      db.exercises.clear(),
      db.sessions.clear(),
      db.sessionExercises.clear(),
      db.sets.clear(),
    ]);

    await db.exercises.bulkAdd(backup.exercises);
    await db.sessions.bulkAdd(backup.sessions);
    await db.sessionExercises.bulkAdd(backup.sessionExercises);
    await db.sets.bulkAdd(backup.sets);
  });

  return summarise(backup);
}

/** Dated file name, so several backups can coexist. */
export function backupFileName(exportedAt: Timestamp = Date.now()): string {
  const date = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `workout-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
