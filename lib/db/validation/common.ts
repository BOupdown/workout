/** Socle partagé par les validateurs de chaque entité. */

export interface ValidationIssue {
  /** Champ concerné, ou `'*'` pour l'entité entière. */
  field: string;
  /** Code stable, pour du branchement dans l'UI. */
  code: string;
  /** Message en clair, affichable tel quel. */
  message: string;
}

export type ValidatedEntity = 'set' | 'session' | 'sessionExercise' | 'exercise';

const ENTITY_LABELS: Record<ValidatedEntity, string> = {
  set: 'Série',
  session: 'Séance',
  sessionExercise: 'Exercice de la séance',
  exercise: 'Exercice',
};

export class ValidationError extends Error {
  readonly entity: ValidatedEntity;
  readonly issues: readonly ValidationIssue[];

  constructor(entity: ValidatedEntity, issues: readonly ValidationIssue[]) {
    super(`${ENTITY_LABELS[entity]} invalide — ${issues.map((i) => i.message).join(' ')}`);
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
// Prédicats
// ---------------------------------------------------------------------------

export const isId = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

export const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export const isTimestamp = (v: unknown): v is number => isNumber(v) && v > 0;

export const isNonNegativeInteger = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0;

/**
 * Garde-fou commun à toutes les entités : un objet, et rien d'autre.
 * Retourne `null` si la valeur est exploitable.
 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

export const notAnObjectIssue = (label: string): ValidationIssue => ({
  field: '*',
  code: 'not_an_object',
  message: `${label} doit être un objet.`,
});
