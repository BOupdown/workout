import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { importDatabase, exportDatabase, type BackupFile } from '../lib/db/backup';
import { deleteExercise } from '../lib/db/exercises';
import {
  checkRetiredExerciseShape,
  RetiredExerciseValidationError,
  ValidationError,
} from '../lib/db/validation';
import { exerciseByKey, resetDatabase } from './helpers';

beforeEach(resetDatabase);

const valid = { nameKey: 'jump rope', retiredAt: 1_787_000_000_000 };

describe('checkRetiredExerciseShape', () => {
  it('accepte une pierre tombale bien formée', () => {
    expect(checkRetiredExerciseShape(valid)).toEqual([]);
  });

  it('refuse ce qui n’est pas un objet', () => {
    expect(checkRetiredExerciseShape(null)).toHaveLength(1);
    expect(checkRetiredExerciseShape('jump rope')).toHaveLength(1);
  });

  it('refuse une clé vide, absente ou blanche', () => {
    // C'est la clé primaire : Dexie refuserait de son côté, mais par une erreur
    // de chemin de clé, pas par une phrase sur le fichier.
    for (const nameKey of [undefined, '', '   ', 42]) {
      const issues = checkRetiredExerciseShape({ ...valid, nameKey });
      expect(issues.map((issue) => issue.field)).toContain('nameKey');
    }
  });

  it('refuse un instant de suppression absurde', () => {
    for (const retiredAt of [undefined, 0, -1, 'hier', Number.NaN]) {
      const issues = checkRetiredExerciseShape({ ...valid, retiredAt });
      expect(issues.map((issue) => issue.field)).toContain('retiredAt');
    }
  });

  it('n’exige pas une forme canonique de la clé', () => {
    // Délibéré : `toNameKey` produit les clés, et vérifier qu'elles en sont un
    // point fixe transformerait tout futur changement de cette normalisation en
    // un refus des propres anciennes sauvegardes de l'utilisateur.
    expect(checkRetiredExerciseShape({ ...valid, nameKey: 'Jump-Rope' })).toEqual([]);
  });

  it('se range sous ValidationError, comme les autres', () => {
    // Les écrans attrapent la classe de base ; une erreur hors de cette
    // hiérarchie s'afficherait comme un échec inconnu.
    expect(new RetiredExerciseValidationError([])).toBeInstanceOf(ValidationError);
  });
});

describe('le garde-fou sur la table', () => {
  it('refuse une écriture directe mal formée', async () => {
    await expect(
      db.retiredExercises.put({ nameKey: '', retiredAt: 1 } as never),
    ).rejects.toBeInstanceOf(RetiredExerciseValidationError);
  });

  it('laisse passer ce que `deleteExercise` écrit', async () => {
    // Le garde-fou ne doit pas refuser le seul chemin d'écriture réel.
    const jumpRope = await exerciseByKey('jump rope');

    await deleteExercise(jumpRope.id);

    expect(await db.retiredExercises.get(jumpRope.nameKey)).toBeDefined();
  });
});

describe('une sauvegarde aux pierres tombales abîmées', () => {
  /** A real backup, with one tombstone replaced by junk. */
  async function backupWithBrokenTombstone(broken: unknown): Promise<BackupFile> {
    const jumpRope = await exerciseByKey('jump rope');
    await deleteExercise(jumpRope.id);

    const backup = await exportDatabase();
    backup.retiredExercises = [broken as never];
    return backup;
  }

  it('est refusée par une erreur de validation, pas par un échec de clé', async () => {
    // Le fond du correctif : sans le garde-fou, Dexie rejette sur un chemin de
    // clé introuvable — un message sur une transaction, que personne ne peut
    // relier à son fichier.
    const backup = await backupWithBrokenTombstone({ retiredAt: 1 });

    await expect(importDatabase(backup)).rejects.toBeInstanceOf(RetiredExerciseValidationError);
  });

  it('ne laisse rien derrière elle', async () => {
    // L'import efface avant d'écrire. Le refus doit donc annuler jusqu'aux
    // effacements, sinon un fichier abîmé vide la base.
    const backup = await backupWithBrokenTombstone({ nameKey: 'squat', retiredAt: -5 });
    const exercisesBefore = await db.exercises.count();

    await expect(importDatabase(backup)).rejects.toThrow();

    expect(await db.exercises.count()).toBe(exercisesBefore);
    expect(await db.retiredExercises.count()).toBe(1);
  });

  it('restaure normalement quand elles sont saines', async () => {
    const jumpRope = await exerciseByKey('jump rope');
    await deleteExercise(jumpRope.id);
    const backup = await exportDatabase();

    await resetDatabase();
    await importDatabase(backup);

    expect(await db.retiredExercises.get('jump rope')).toBeDefined();
  });
});
