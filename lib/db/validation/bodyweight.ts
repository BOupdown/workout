/**
 * Validation of `BodyWeight`.
 *
 * Structural only, like the others: nothing here needs to read another entity,
 * so it all runs inside the Dexie write hook.
 */

import { isLocalDate } from '../keys';
import {
  asRecord,
  isNumber,
  isTimestamp,
  notAnObjectIssue,
  SessionValidationError,
  type ValidationIssue,
} from './common';
import { SESSION_LIMITS } from './session';

export function checkBodyWeightShape(value: unknown): ValidationIssue[] {
  const b = asRecord(value);
  if (!b) return [notAnObjectIssue('bodyweight')];

  const issues: ValidationIssue[] = [];

  // The primary key. A malformed one would silently create a row nothing can
  // ever look up, since every read goes by date.
  if (!isLocalDate(b.date)) {
    issues.push({
      field: 'date',
      code: 'invalid_date',
      message: 'Date must be formatted YYYY-MM-DD.',
    });
  }

  // The same bound the session field used, kept deliberately: it is the same
  // quantity, and letting the new home be laxer than the old one would make
  // the migration a way to smuggle in values the app used to refuse.
  if (!isNumber(b.weightKg) || b.weightKg <= 0) {
    issues.push({
      field: 'weightKg',
      code: 'invalid_bodyweight',
      message: 'Bodyweight must be a positive number, in kilograms.',
    });
  } else if (b.weightKg > SESSION_LIMITS.maxBodyweightKg) {
    issues.push({
      field: 'weightKg',
      code: 'bodyweight_out_of_range',
      message: `Bodyweight cannot exceed ${SESSION_LIMITS.maxBodyweightKg} kg.`,
    });
  }

  if (!isTimestamp(b.recordedAt)) {
    issues.push({
      field: 'recordedAt',
      code: 'invalid_timestamp',
      message: '“recordedAt” must be a positive timestamp.',
    });
  }

  return issues;
}

export function assertBodyWeightShape(value: unknown): void {
  const issues = checkBodyWeightShape(value);
  if (issues.length > 0) throw new SessionValidationError(issues);
}
