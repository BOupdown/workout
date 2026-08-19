/** Shared foundation for every entity validator. */

export interface ValidationIssue {
  /** The field concerned, or `'*'` for the whole entity. */
  field: string;
  /** Stable code, for branching in the UI. */
  code: string;
  /** Plain message, displayable as is. */
  message: string;
}

export type ValidatedEntity = 'set' | 'session' | 'sessionExercise' | 'exercise';

const ENTITY_LABELS: Record<ValidatedEntity, string> = {
  set: 'Set',
  session: 'Session',
  sessionExercise: 'Session exercise',
  exercise: 'Exercise',
};

export class ValidationError extends Error {
  readonly entity: ValidatedEntity;
  readonly issues: readonly ValidationIssue[];

  constructor(entity: ValidatedEntity, issues: readonly ValidationIssue[]) {
    super(`Invalid ${ENTITY_LABELS[entity].toLowerCase()}. ${issues.map((i) => i.message).join(' ')}`);
    this.name = 'ValidationError';
    this.entity = entity;
    this.issues = issues;
  }
}

export class SetValidationError extends ValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('set', issues);
    this.name = 'SetValidationError';
  }
}

export class SessionValidationError extends ValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('session', issues);
    this.name = 'SessionValidationError';
  }
}

export class SessionExerciseValidationError extends ValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('sessionExercise', issues);
    this.name = 'SessionExerciseValidationError';
  }
}

export class ExerciseValidationError extends ValidationError {
  constructor(issues: readonly ValidationIssue[]) {
    super('exercise', issues);
    this.name = 'ExerciseValidationError';
  }
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

export const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

export const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export const isTimestamp = (v: unknown): v is number => isNumber(v) && v > 0;

export const isNonNegativeInteger = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0;

/**
 * Guard common to every entity: an object, and nothing else.
 * Returns `null` when the value is usable.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

export const notAnObjectIssue = (label: string): ValidationIssue => ({
  field: '*',
  code: 'not_an_object',
  message: `${label} must be an object.`,
});
