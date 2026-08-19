/**
 * Validation of `Exercise` invariants.
 *
 * Everything here is structural: an exercise depends on no other entity. The
 * rules that do depend on the database - uniqueness of `nameKey`, sets already
 * logged - live in the transactional layer `../exercises`.
 */

import { toNameKey } from '../keys';
import type { EffortMetric, Exercise, LoadType, MuscleGroup } from '../types';
import {
  asRecord,
  ExerciseValidationError,
  isId,
  isNumber,
  isTimestamp,
  notAnObjectIssue,
  type ValidationIssue,
} from './common';

export const EXERCISE_LIMITS = {
  maxNameLength: 80,
  maxIncrementKg: 100,
} as const;

/**
 * Membership tables declared as `Record<Union, true>` rather than arrays: adding
 * a member to the union without adding it here becomes a compile error. A plain
 * array would only catch values that do not belong.
 */
const LOAD_TYPES: Record<LoadType, true> = {
  external: true,
  bodyweight: true,
  weighted_bodyweight: true,
  assisted: true,
};

const METRICS: Record<EffortMetric, true> = {
  reps: true,
  time: true,
};

const MUSCLE_GROUPS: Record<MuscleGroup, true> = {
  chest: true,
  back: true,
  shoulders: true,
  biceps: true,
  triceps: true,
  forearms: true,
  quads: true,
  hamstrings: true,
  glutes: true,
  calves: true,
  core: true,
  fullbody: true,
  cardio: true,
};

const isMember = (table: object, value: unknown): boolean =>
  typeof value === 'string' && Object.hasOwn(table, value);

export const isLoadType = (v: unknown): v is LoadType => isMember(LOAD_TYPES, v);
export const isEffortMetric = (v: unknown): v is EffortMetric => isMember(METRICS, v);
export const isMuscleGroup = (v: unknown): v is MuscleGroup => isMember(MUSCLE_GROUPS, v);

export function checkExerciseShape(value: unknown): ValidationIssue[] {
  const e = asRecord(value);
  if (!e) return [notAnObjectIssue('An exercise')];

  const issues: ValidationIssue[] = [];

  if (!isId(e.id)) {
    issues.push({
      field: 'id',
      code: 'invalid_id',
      message: 'Exercise id must be a non-empty identifier.',
    });
  }

  const hasUsableName = typeof e.name === 'string' && e.name.trim().length > 0;
  if (!hasUsableName) {
    issues.push({
      field: 'name',
      code: 'invalid_name',
      message: 'The exercise name cannot be empty.',
    });
  } else if ((e.name as string).length > EXERCISE_LIMITS.maxNameLength) {
    issues.push({
      field: 'name',
      code: 'name_too_long',
      message: `The name cannot exceed ${EXERCISE_LIMITS.maxNameLength} characters.`,
    });
  }

  // A strong invariant, checkable without a read since both fields sit on the
  // same row: `nameKey` is *always* the normalisation of `name`. This is what
  // prevents bypassing the unique `&nameKey` index with an inconsistent pair,
  // and so fragmenting a single movement's history.
  if (hasUsableName) {
    const expected = toNameKey(e.name as string);
    if (e.nameKey !== expected) {
      issues.push({
        field: 'nameKey',
        code: 'name_key_mismatch',
        message: `The name key must be ${expected}, derived from ${e.name as string}.`,
      });
    }
  } else if (!isId(e.nameKey)) {
    issues.push({
      field: 'nameKey',
      code: 'invalid_name_key',
      message: 'The name key must be a non-empty key.',
    });
  }

  if (!isLoadType(e.loadType)) {
    issues.push({
      field: 'loadType',
      code: 'invalid_load_type',
      message: `Load type must be one of ${Object.keys(LOAD_TYPES).join(', ')}.`,
    });
  }

  if (!isEffortMetric(e.metric)) {
    issues.push({
      field: 'metric',
      code: 'invalid_metric',
      message: `Metric must be ${Object.keys(METRICS).join(' or ')}.`,
    });
  }

  for (const field of ['perSide', 'isCustom'] as const) {
    if (typeof e[field] !== 'boolean') {
      issues.push({
        field,
        code: 'invalid_flag',
        message: `Field ${field} must be a boolean.`,
      });
    }
  }

  if (!isTimestamp(e.createdAt)) {
    issues.push({
      field: 'createdAt',
      code: 'invalid_timestamp',
      message: 'Creation time must be a positive timestamp.',
    });
  }

  if (e.archivedAt !== undefined && !isTimestamp(e.archivedAt)) {
    issues.push({
      field: 'archivedAt',
      code: 'invalid_timestamp',
      message: 'Archive time must be a positive timestamp.',
    });
  }

  if (e.muscleGroup !== undefined && !isMuscleGroup(e.muscleGroup)) {
    issues.push({
      field: 'muscleGroup',
      code: 'invalid_muscle_group',
      message: 'That is not a known muscle group.',
    });
  }

  if (e.defaultIncrementKg !== undefined) {
    if (!isNumber(e.defaultIncrementKg) || e.defaultIncrementKg <= 0) {
      issues.push({
        field: 'defaultIncrementKg',
        code: 'invalid_increment',
        message: 'The progression step must be a positive number, in kilograms.',
      });
    } else if (e.defaultIncrementKg > EXERCISE_LIMITS.maxIncrementKg) {
      issues.push({
        field: 'defaultIncrementKg',
        code: 'increment_out_of_range',
        message: `The progression step cannot exceed ${EXERCISE_LIMITS.maxIncrementKg} kg.`,
      });
    } else if (e.loadType === 'bodyweight') {
      // Internal consistency: a bodyweight exercise has no load field, so no
      // progression step to offer.
      issues.push({
        field: 'defaultIncrementKg',
        code: 'increment_without_load',
        message: 'A bodyweight exercise has no progression step.',
      });
    }
  }

  if (e.notes !== undefined && typeof e.notes !== 'string') {
    issues.push({
      field: 'notes',
      code: 'invalid_notes',
      message: 'Notes must be text.',
    });
  }

  return issues;
}

export function assertExerciseShape(value: unknown): void {
  const issues = checkExerciseShape(value);
  if (issues.length > 0) throw new ExerciseValidationError(issues);
}

/** Reduced view, for the UI building a creation form. */
export type ExerciseDraft = Pick<Exercise, 'name' | 'loadType' | 'metric'>;
