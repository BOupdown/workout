/**
 * Validation of `RetiredExercise` — the tombstone of a deleted catalogue entry.
 *
 * Structural only, like the others: nothing here reads another entity, so it
 * runs inside the Dexie write hook.
 */

import {
  asRecord,
  isId,
  isTimestamp,
  notAnObjectIssue,
  RetiredExerciseValidationError,
  type ValidationIssue,
} from './common';

export function checkRetiredExerciseShape(value: unknown): ValidationIssue[] {
  const t = asRecord(value);
  if (!t) return [notAnObjectIssue('Deleted exercise')];

  const issues: ValidationIssue[] = [];

  /*
   * The primary key. Without it Dexie refuses the write on its own — but as a
   * key-path error, which inside a restore surfaces as a failed transaction
   * rather than as a sentence about the file. Named here so a broken backup is
   * refused the way every other table's rows are.
   *
   * Only "a usable key" is required, deliberately, not canonical form. A key
   * is produced by `toNameKey`, so checking `toNameKey(k) === k` would be
   * stricter and tempting — and would turn any future change to that
   * normalisation into a restore that rejects the user's own older backups.
   * Refusing to read somebody's history to enforce a spelling rule is the
   * wrong trade in an app whose backup is the only copy.
   */
  if (!isId(t.nameKey)) {
    issues.push({
      field: 'nameKey',
      code: 'invalid_name_key',
      message: 'A deleted exercise must carry a non-empty name key.',
    });
  }

  if (!isTimestamp(t.retiredAt)) {
    issues.push({
      field: 'retiredAt',
      code: 'invalid_timestamp',
      message: '“retiredAt” must be a positive timestamp.',
    });
  }

  return issues;
}

export function assertRetiredExerciseShape(value: unknown): void {
  const issues = checkRetiredExerciseShape(value);
  if (issues.length > 0) throw new RetiredExerciseValidationError(issues);
}
