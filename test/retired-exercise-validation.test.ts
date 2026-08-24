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
  it('accepts a well-formed tombstone', () => {
    expect(checkRetiredExerciseShape(valid)).toEqual([]);
  });

  it('refuses what is not an object', () => {
    expect(checkRetiredExerciseShape(null)).toHaveLength(1);
    expect(checkRetiredExerciseShape('jump rope')).toHaveLength(1);
  });

  it('refuses a key that is empty, absent or blank', () => {
    // This is the primary key: Dexie would refuse it too, but through a key
    // path error rather than a sentence about the file.
    for (const nameKey of [undefined, '', '   ', 42]) {
      const issues = checkRetiredExerciseShape({ ...valid, nameKey });
      expect(issues.map((issue) => issue.field)).toContain('nameKey');
    }
  });

  it('refuses an absurd deletion instant', () => {
    for (const retiredAt of [undefined, 0, -1, 'hier', Number.NaN]) {
      const issues = checkRetiredExerciseShape({ ...valid, retiredAt });
      expect(issues.map((issue) => issue.field)).toContain('retiredAt');
    }
  });

  it('does not demand a canonical form of the key', () => {
    // Deliberate: `toNameKey` produces the keys, and asserting they are a fixed
    // point of it would turn any future change to that normalisation into a
    // refusal of the user's own older backups.
    expect(checkRetiredExerciseShape({ ...valid, nameKey: 'Jump-Rope' })).toEqual([]);
  });

  it('sits under ValidationError, like the others', () => {
    // The screens catch the base class; an error outside that hierarchy would
    // show up as an unknown failure.
    expect(new RetiredExerciseValidationError([])).toBeInstanceOf(ValidationError);
  });
});

describe('the guard on the table', () => {
  it('refuses a malformed direct write', async () => {
    await expect(
      db.retiredExercises.put({ nameKey: '', retiredAt: 1 } as never),
    ).rejects.toBeInstanceOf(RetiredExerciseValidationError);
  });

  it('lets through what `deleteExercise` writes', async () => {
    // The guard must not refuse the one real write path.
    const jumpRope = await exerciseByKey('jump rope');

    await deleteExercise(jumpRope.id);

    expect(await db.retiredExercises.get(jumpRope.nameKey)).toBeDefined();
  });
});

describe('a backup with damaged tombstones', () => {
  /** A real backup, with one tombstone replaced by junk. */
  async function backupWithBrokenTombstone(broken: unknown): Promise<BackupFile> {
    const jumpRope = await exerciseByKey('jump rope');
    await deleteExercise(jumpRope.id);

    const backup = await exportDatabase();
    backup.retiredExercises = [broken as never];
    return backup;
  }

  it('is refused by a validation error, not by a key failure', async () => {
    // The substance of the fix: without the guard, Dexie rejects on a key path
    // it cannot find — a message about a transaction, which nobody can connect
    // to their file.
    const backup = await backupWithBrokenTombstone({ retiredAt: 1 });

    await expect(importDatabase(backup)).rejects.toBeInstanceOf(RetiredExerciseValidationError);
  });

  it('leaves nothing behind it', async () => {
    // The import clears before it writes. The refusal therefore has to roll the
    // clearing back too, or a damaged file empties the database.
    const backup = await backupWithBrokenTombstone({ nameKey: 'squat', retiredAt: -5 });
    const exercisesBefore = await db.exercises.count();

    await expect(importDatabase(backup)).rejects.toThrow();

    expect(await db.exercises.count()).toBe(exercisesBefore);
    expect(await db.retiredExercises.count()).toBe(1);
  });

  it('restores as usual when they are sound', async () => {
    const jumpRope = await exerciseByKey('jump rope');
    await deleteExercise(jumpRope.id);
    const backup = await exportDatabase();

    await resetDatabase();
    await importDatabase(backup);

    expect(await db.retiredExercises.get('jump rope')).toBeDefined();
  });
});
