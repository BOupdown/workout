/**
 * Sauvegarde et restauration de la base entière.
 *
 * Sans backend, c'est la **seule garantie réelle** contre la perte de données :
 * `navigator.storage.persist()` et l'installation réduisent le risque
 * d'éviction, ils ne l'éliminent pas. Vider les données du site reste
 * irréversible, et un fichier que l'utilisateur détient ne l'est pas.
 *
 * La restauration **remplace** tout, elle ne fusionne pas. Fusionner
 * buterait sur l'index unique `&nameKey` : le catalogue livré existe des deux
 * côtés avec des identifiants différents mais les mêmes noms normalisés.
 * Réconcilier deux appareils est un problème de synchronisation, pas de
 * sauvegarde, et il demande un serveur.
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

/** Instantané complet de la base, sérialisable tel quel en JSON. */
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
 * Vérifie l'enveloppe **sans rien écrire**, pour pouvoir refuser un fichier
 * étranger avant d'avoir touché aux données existantes.
 *
 * Le contenu des lignes n'est pas contrôlé ici : les hooks structurels de Dexie
 * s'en chargent à l'écriture, avec les mêmes règles que la saisie. Une
 * sauvegarde ne peut donc pas réintroduire de données invalides.
 */
export function readBackup(value: unknown): BackupFile {
  if (typeof value !== 'object' || value === null) {
    throw new BackupFormatError('Ce fichier n’est pas une sauvegarde Workout.');
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.format !== BACKUP_FORMAT) {
    throw new BackupFormatError('Ce fichier n’est pas une sauvegarde Workout.');
  }

  if (candidate.version !== BACKUP_VERSION) {
    throw new BackupFormatError(
      `Sauvegarde en version ${String(candidate.version)}, cette app lit la version ${BACKUP_VERSION}.`,
    );
  }

  for (const table of TABLES) {
    if (!Array.isArray(candidate[table])) {
      throw new BackupFormatError(`Sauvegarde incomplète : « ${table} » est absent ou illisible.`);
    }
  }

  return candidate as unknown as BackupFile;
}

/** Analyse une chaîne JSON et en vérifie l'enveloppe. */
export function parseBackup(json: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupFormatError('Fichier illisible : ce n’est pas du JSON valide.');
  }
  return readBackup(parsed);
}

/**
 * Remplace le contenu de la base par celui de la sauvegarde.
 *
 * Tout se joue dans **une seule transaction** : si une ligne est refusée par la
 * validation, rien n'est écrit et les données existantes sont intactes. Une
 * sauvegarde corrompue ne peut donc pas détruire ce qui est déjà là.
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

/** Nom de fichier daté, pour que plusieurs sauvegardes cohabitent. */
export function backupFileName(exportedAt: Timestamp = Date.now()): string {
  const date = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `workout-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
