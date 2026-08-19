/**
 * Validation of `Session` and `SessionExercise` invariants.
 *
 * Same split as for sets: whatever needs no read goes to the Dexie hooks, and
 * whatever requires reading another entity stays in the transactional layer
 * (`../sessions`).
 */

import { isLocalDate } from '../keys';
import type { Exercise } from '../types';
import {
  asRecord,
  isId,
  isNonNegativeInteger,
  isNumber,
  isTimestamp,
  notAnObjectIssue,
  SessionExerciseValidationError,
  SessionValidationError,
  type ValidationIssue,
} from './common';

/** Entry guards, same reasoning as `SET_LIMITS`. */
export const SESSION_LIMITS = {
  maxBodyweightKg: 700,
} as const;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Structural invariants of a session.
 *
 * Note: the **format** of `date` is checked, but not its consistency with
 * `startedAt`. `date` is frozen at creation, in the user's timezone at that
 * moment; requiring it to always match the local day of `startedAt` would break
 * every session logged before a timezone change.
 */
export function checkSessionShape(value: unknown): ValidationIssue[] {
  const s = asRecord(value);
  if (!s) return [notAnObjectIssue('A session')];

  const issues: ValidationIssue[] = [];

  if (!isId(s.id)) {
    issues.push({
      field: 'id',
      code: 'invalid_id',
      message: 'Session id must be a non-empty identifier.',
    });
  }

  for (const field of ['startedAt', 'createdAt'] as const) {
    if (!isTimestamp(s[field])) {
      issues.push({
        field,
        code: 'invalid_timestamp',
        message: `Field ${field} must be a positive timestamp.`,
      });
    }
  }

  if (!isLocalDate(s.date)) {
    issues.push({
      field: 'date',
      code: 'invalid_date',
      message: 'Date must be a real day in YYYY-MM-DD form.',
    });
  }

  if (s.endedAt !== undefined) {
    if (!isTimestamp(s.endedAt)) {
      issues.push({
        field: 'endedAt',
        code: 'invalid_timestamp',
        message: 'End time must be a positive timestamp.',
      });
    } else if (isTimestamp(s.startedAt) && s.endedAt < s.startedAt) {
      // Structural: both fields sit on the same row, no read involved.
      issues.push({
        field: 'endedAt',
        code: 'ends_before_start',
        message: 'A session cannot end before it started.',
      });
    }
  }

  if (s.bodyweightKg !== undefined) {
    if (!isNumber(s.bodyweightKg) || s.bodyweightKg <= 0) {
      issues.push({
        field: 'bodyweightKg',
        code: 'invalid_bodyweight',
        message: 'Bodyweight must be a positive number, in kilograms.',
      });
    } else if (s.bodyweightKg > SESSION_LIMITS.maxBodyweightKg) {
      issues.push({
        field: 'bodyweightKg',
        code: 'bodyweight_out_of_range',
        message: `Bodyweight cannot exceed ${SESSION_LIMITS.maxBodyweightKg} kg.`,
      });
    }
  }

  for (const field of ['title', 'notes'] as const) {
    if (s[field] !== undefined && typeof s[field] !== 'string') {
      issues.push({
        field,
        code: 'invalid_text',
        message: `Field ${field} must be text.`,
      });
    }
  }

  return issues;
}

export function assertSessionShape(value: unknown): void {
  const issues = checkSessionShape(value);
  if (issues.length > 0) throw new SessionValidationError(issues);
}

// ---------------------------------------------------------------------------
// SessionExercise
// ---------------------------------------------------------------------------

export function checkSessionExerciseShape(value: unknown): ValidationIssue[] {
  const b = asRecord(value);
  if (!b) return [notAnObjectIssue('A session exercise')];

  const issues: ValidationIssue[] = [];

  for (const field of ['id', 'sessionId', 'exerciseId'] as const) {
    if (!isId(b[field])) {
      issues.push({
        field,
        code: 'invalid_id',
        message: `Field ${field} must be a non-empty identifier.`,
      });
    }
  }

  if (!isNonNegativeInteger(b.order)) {
    issues.push({
      field: 'order',
      code: 'invalid_order',
      message: 'Order must be a non-negative integer.',
    });
  }

  if (b.supersetGroup !== undefined && !isNonNegativeInteger(b.supersetGroup)) {
    issues.push({
      field: 'supersetGroup',
      code: 'invalid_superset_group',
      message: 'Superset group must be a non-negative integer.',
    });
  }

  if (b.notes !== undefined && typeof b.notes !== 'string') {
    issues.push({
      field: 'notes',
      code: 'invalid_notes',
      message: 'Notes must be text.',
    });
  }

  return issues;
}

export function assertSessionExerciseShape(value: unknown): void {
  const issues = checkSessionExerciseShape(value);
  if (issues.length > 0) throw new SessionExerciseValidationError(issues);
}

/**
 * Contextual check: an archived exercise cannot be added to a session. That is
 * the whole point of archiving - taking a movement out of the picker without
 * touching the history already logged.
 */
export function assertExerciseSelectable(exercise: Pick<Exercise, 'name' | 'archivedAt'>): void {
  if (exercise.archivedAt !== undefined) {
    throw new SessionExerciseValidationError([
      {
        field: 'exerciseId',
        code: 'exercise_archived',
        message: `${exercise.name} is archived and cannot be added to a session.`,
      },
    ]);
  }
}
