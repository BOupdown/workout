/**
 * Validation of `SetEntry` invariants.
 *
 * Split in two, forced by Dexie: the `creating` / `updating` hooks are
 * **synchronous**, so they cannot go and read the parent `Exercise`.
 *
 *   checkSetShape()            structural, context-free   → Dexie hooks
 *   checkSetAgainstExercise()  depends on the exercise     → the `../sets` layer
 *
 * `setFieldRequirements()` is the single source of truth: both the validation
 * *and* the UI (which fields to show) derive from it, so they cannot diverge.
 */

import type { Exercise, LoadType, SetEntry } from '../types';
import {
  asRecord,
  isId,
  isNonNegativeInteger,
  isNumber,
  isTimestamp,
  notAnObjectIssue,
  SetValidationError,
  type ValidationIssue,
} from './common';

/**
 * Entry bounds. These are not physiological limits but guards against typos:
 * phone in hand between two sets, "1000" instead of "100" happens fast.
 */
export const SET_LIMITS = {
  maxWeightKg: 1000,
  maxReps: 1000,
  maxDurationSec: 86_400,
  minRpe: 1,
  maxRpe: 10,
} as const;

// ---------------------------------------------------------------------------
// Single source of truth: which fields for which exercise
// ---------------------------------------------------------------------------

export type FieldRequirement = 'required' | 'forbidden';

export interface SetFieldRequirements {
  weightKg: FieldRequirement;
  reps: FieldRequirement;
  durationSec: FieldRequirement;
  /** Label for the load field, or `null` when the exercise has none. */
  weightLabel: string | null;
}

const WEIGHT_LABELS: Record<LoadType, string | null> = {
  external: 'Load',
  bodyweight: null,
  weighted_bodyweight: 'Added',
  assisted: 'Assist',
};

/** An exercise reduced to what the validation needs. */
export type ExerciseRules = Pick<Exercise, 'loadType' | 'metric' | 'name'>;

/**
 * What a set must contain for this exercise. Use it in the UI too, to decide
 * which fields to render — that is the point which guarantees a form cannot
 * produce a set the database would reject.
 */
export function setFieldRequirements(
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): SetFieldRequirements {
  return {
    // Bodyweight alone has no load to enter. The other three do, even when it
    // can be 0 (a pull-up with no belt, a machine with no assistance): that is
    // a measured value, not an absence.
    weightKg: exercise.loadType === 'bodyweight' ? 'forbidden' : 'required',
    reps: exercise.metric === 'reps' ? 'required' : 'forbidden',
    durationSec: exercise.metric === 'time' ? 'required' : 'forbidden',
    weightLabel: WEIGHT_LABELS[exercise.loadType],
  };
}

// ---------------------------------------------------------------------------
// Structural checks (context-free)
// ---------------------------------------------------------------------------

const ID_FIELDS = ['id', 'sessionExerciseId', 'sessionId', 'exerciseId'] as const;

/**
 * Invariants checkable without reading anything else: types, bounds, enum
 * values. Wired to the Dexie hooks, so unbypassable — including from the
 * browser console or a future data import.
 */
export function checkSetShape(value: unknown): ValidationIssue[] {
  const s = asRecord(value);
  if (!s) return [notAnObjectIssue('A set')];

  const issues: ValidationIssue[] = [];

  for (const field of ID_FIELDS) {
    if (!isId(s[field])) {
      issues.push({
        field,
        code: 'invalid_id',
        message: `“${field}” must be a non-empty identifier.`,
      });
    }
  }

  for (const field of ['performedAt', 'loggedAt'] as const) {
    if (!isTimestamp(s[field])) {
      issues.push({
        field,
        code: 'invalid_timestamp',
        message: `“${field}” must be a positive timestamp.`,
      });
    }
  }

  if (!isNonNegativeInteger(s.order)) {
    issues.push({
      field: 'order',
      code: 'invalid_order',
      message: '“order” must be a non-negative integer.',
    });
  }

  if (s.kind !== 'work' && s.kind !== 'warmup') {
    issues.push({
      field: 'kind',
      code: 'invalid_kind',
      message: '“kind” must be “work” or “warmup”.',
    });
  }

  if (s.weightKg !== undefined) {
    if (!isNumber(s.weightKg) || s.weightKg < 0) {
      issues.push({
        field: 'weightKg',
        code: 'invalid_weight',
        message: 'The load must be a non-negative number.',
      });
    } else if (s.weightKg > SET_LIMITS.maxWeightKg) {
      issues.push({
        field: 'weightKg',
        code: 'weight_out_of_range',
        message: `The load cannot exceed ${SET_LIMITS.maxWeightKg} kg.`,
      });
    }
  }

  if (s.reps !== undefined) {
    if (!Number.isInteger(s.reps) || (s.reps as number) < 1) {
      issues.push({
        field: 'reps',
        code: 'invalid_reps',
        message: 'Reps must be a whole number of 1 or more.',
      });
    } else if ((s.reps as number) > SET_LIMITS.maxReps) {
      issues.push({
        field: 'reps',
        code: 'reps_out_of_range',
        message: `Reps cannot exceed ${SET_LIMITS.maxReps}.`,
      });
    }
  }

  if (s.durationSec !== undefined) {
    if (!isNumber(s.durationSec) || s.durationSec <= 0) {
      issues.push({
        field: 'durationSec',
        code: 'invalid_duration',
        message: 'Duration must be a positive number of seconds.',
      });
    } else if (s.durationSec > SET_LIMITS.maxDurationSec) {
      issues.push({
        field: 'durationSec',
        code: 'duration_out_of_range',
        message: `Duration cannot exceed ${SET_LIMITS.maxDurationSec} seconds.`,
      });
    }
  }

  if (s.rpe !== undefined) {
    const rpe = s.rpe;
    const inRange = isNumber(rpe) && rpe >= SET_LIMITS.minRpe && rpe <= SET_LIMITS.maxRpe;
    // Half points only: RPE is written 7, 7.5, 8…
    if (!inRange || !Number.isInteger(rpe * 2)) {
      issues.push({
        field: 'rpe',
        code: 'invalid_rpe',
        message: `RPE must be between ${SET_LIMITS.minRpe} and ${SET_LIMITS.maxRpe}, in steps of 0.5.`,
      });
    }
  }

  if (s.isFailure !== undefined && typeof s.isFailure !== 'boolean') {
    issues.push({
      field: 'isFailure',
      code: 'invalid_is_failure',
      message: '“isFailure” must be a boolean.',
    });
  }

  if (s.notes !== undefined && typeof s.notes !== 'string') {
    issues.push({
      field: 'notes',
      code: 'invalid_notes',
      message: 'Notes must be text.',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Checks that depend on the parent exercise
// ---------------------------------------------------------------------------

/** The only measures whose validity depends on the exercise. */
export type SetMeasures = Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>;

const MEASURE_LABELS: Record<keyof SetMeasures, string> = {
  weightKg: 'a load',
  reps: 'reps',
  durationSec: 'a duration',
};

/**
 * Checks that the measures present match what the exercise expects. This is
 * where the bodyweight case and the timed case are settled.
 */
export function checkSetAgainstExercise(
  measures: SetMeasures,
  exercise: ExerciseRules,
): ValidationIssue[] {
  const required = setFieldRequirements(exercise);
  const issues: ValidationIssue[] = [];

  for (const field of ['weightKg', 'reps', 'durationSec'] as const) {
    const isPresent = measures[field] !== undefined;

    if (required[field] === 'required' && !isPresent) {
      issues.push({
        field,
        code: 'field_required',
        message: `“${exercise.name}” expects ${MEASURE_LABELS[field]}.`,
      });
    }

    if (required[field] === 'forbidden' && isPresent) {
      issues.push({
        field,
        code: 'field_forbidden',
        message: `“${exercise.name}” does not take ${MEASURE_LABELS[field]}.`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Facades
// ---------------------------------------------------------------------------

/** Every check. Meant for the UI, which wants the list rather than a throw. */
export function validateSet(set: SetEntry, exercise: ExerciseRules): ValidationIssue[] {
  return [...checkSetShape(set), ...checkSetAgainstExercise(set, exercise)];
}

/** Throwing variant used by the Dexie hooks (aborts the transaction). */
export function assertSetShape(value: unknown): void {
  const issues = checkSetShape(value);
  if (issues.length > 0) throw new SetValidationError(issues);
}

/** Full throwing variant, used by the write layer. */
export function assertValidSet(set: SetEntry, exercise: ExerciseRules): void {
  const issues = validateSet(set, exercise);
  if (issues.length > 0) throw new SetValidationError(issues);
}
