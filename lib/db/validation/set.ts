/**
 * Validation des invariants de `SetEntry`.
 *
 * Découpage en deux, imposé par Dexie : les hooks `creating` / `updating` sont
 * **synchrones**, ils ne peuvent donc pas aller lire l'`Exercise` parent.
 *
 *   checkSetShape()            structurel, sans contexte     → hooks Dexie
 *   checkSetAgainstExercise()  dépend de l'exercice parent    → couche `../sets`
 *
 * `setFieldRequirements()` est la source de vérité unique : la validation *et*
 * l'UI (quels champs afficher) en dérivent, elles ne peuvent donc pas diverger.
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
 * Bornes de saisie. Ce ne sont pas des limites physiologiques mais des
 * garde-fous contre la faute de frappe : téléphone en main entre deux séries,
 * « 1000 » au lieu de « 100 » est vite arrivé.
 */
export const SET_LIMITS = {
  maxWeightKg: 1000,
  maxReps: 1000,
  maxDurationSec: 86_400,
  minRpe: 1,
  maxRpe: 10,
} as const;

// ---------------------------------------------------------------------------
// Source de vérité : quels champs pour quel exercice
// ---------------------------------------------------------------------------

export type FieldRequirement = 'required' | 'forbidden';

export interface SetFieldRequirements {
  weightKg: FieldRequirement;
  reps: FieldRequirement;
  durationSec: FieldRequirement;
  /** Libellé du champ de charge, ou `null` si l'exercice n'en a pas. */
  weightLabel: string | null;
}

const WEIGHT_LABELS: Record<LoadType, string | null> = {
  external: 'Charge',
  bodyweight: null,
  weighted_bodyweight: 'Lest',
  assisted: 'Assistance',
};

/** Exercice réduit à ce dont la validation a besoin. */
export type ExerciseRules = Pick<Exercise, 'loadType' | 'metric' | 'name'>;

/**
 * Ce qu'une série doit contenir pour cet exercice. À utiliser aussi dans l'UI
 * pour décider quels champs afficher — c'est le point qui garantit qu'un
 * formulaire ne peut pas produire une série que la base refusera.
 */
export function setFieldRequirements(
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): SetFieldRequirements {
  return {
    // Le poids du corps seul n'a pas de charge à saisir. Les trois autres cas en
    // ont une, même si elle peut valoir 0 (traction sans lest, machine sans
    // assistance) : c'est une valeur mesurée, pas une absence.
    weightKg: exercise.loadType === 'bodyweight' ? 'forbidden' : 'required',
    reps: exercise.metric === 'reps' ? 'required' : 'forbidden',
    durationSec: exercise.metric === 'time' ? 'required' : 'forbidden',
    weightLabel: WEIGHT_LABELS[exercise.loadType],
  };
}

// ---------------------------------------------------------------------------
// Contrôles structurels (sans contexte)
// ---------------------------------------------------------------------------

const ID_FIELDS = ['id', 'sessionExerciseId', 'sessionId', 'exerciseId'] as const;

/**
 * Invariants vérifiables sans rien lire d'autre : types, bornes, valeurs
 * d'énumération. Branché sur les hooks Dexie, donc infranchissable — y compris
 * depuis la console du navigateur ou un futur import de données.
 */
export function checkSetShape(value: unknown): ValidationIssue[] {
  const s = asRecord(value);
  if (!s) return [notAnObjectIssue('La série')];

  const issues: ValidationIssue[] = [];

  for (const field of ID_FIELDS) {
    if (!isId(s[field])) {
      issues.push({
        field,
        code: 'invalid_id',
        message: `« ${field} » doit être un identifiant non vide.`,
      });
    }
  }

  for (const field of ['performedAt', 'loggedAt'] as const) {
    if (!isTimestamp(s[field])) {
      issues.push({
        field,
        code: 'invalid_timestamp',
        message: `« ${field} » doit être un timestamp positif.`,
      });
    }
  }

  if (!isNonNegativeInteger(s.order)) {
    issues.push({
      field: 'order',
      code: 'invalid_order',
      message: '« order » doit être un entier positif ou nul.',
    });
  }

  if (s.kind !== 'work' && s.kind !== 'warmup') {
    issues.push({
      field: 'kind',
      code: 'invalid_kind',
      message: '« kind » doit valoir « work » ou « warmup ».',
    });
  }

  if (s.weightKg !== undefined) {
    if (!isNumber(s.weightKg) || s.weightKg < 0) {
      issues.push({
        field: 'weightKg',
        code: 'invalid_weight',
        message: 'La charge doit être un nombre positif ou nul, en kg.',
      });
    } else if (s.weightKg > SET_LIMITS.maxWeightKg) {
      issues.push({
        field: 'weightKg',
        code: 'weight_out_of_range',
        message: `La charge ne peut pas dépasser ${SET_LIMITS.maxWeightKg} kg.`,
      });
    }
  }

  if (s.reps !== undefined) {
    if (!Number.isInteger(s.reps) || (s.reps as number) < 1) {
      issues.push({
        field: 'reps',
        code: 'invalid_reps',
        message: 'Le nombre de répétitions doit être un entier ≥ 1.',
      });
    } else if ((s.reps as number) > SET_LIMITS.maxReps) {
      issues.push({
        field: 'reps',
        code: 'reps_out_of_range',
        message: `Le nombre de répétitions ne peut pas dépasser ${SET_LIMITS.maxReps}.`,
      });
    }
  }

  if (s.durationSec !== undefined) {
    if (!isNumber(s.durationSec) || s.durationSec <= 0) {
      issues.push({
        field: 'durationSec',
        code: 'invalid_duration',
        message: 'La durée doit être un nombre de secondes strictement positif.',
      });
    } else if (s.durationSec > SET_LIMITS.maxDurationSec) {
      issues.push({
        field: 'durationSec',
        code: 'duration_out_of_range',
        message: `La durée ne peut pas dépasser ${SET_LIMITS.maxDurationSec} secondes.`,
      });
    }
  }

  if (s.rpe !== undefined) {
    const rpe = s.rpe;
    const inRange = isNumber(rpe) && rpe >= SET_LIMITS.minRpe && rpe <= SET_LIMITS.maxRpe;
    // Demi-points uniquement : le RPE se note 7, 7.5, 8…
    if (!inRange || !Number.isInteger(rpe * 2)) {
      issues.push({
        field: 'rpe',
        code: 'invalid_rpe',
        message: `Le RPE doit être compris entre ${SET_LIMITS.minRpe} et ${SET_LIMITS.maxRpe}, par pas de 0,5.`,
      });
    }
  }

  if (s.isFailure !== undefined && typeof s.isFailure !== 'boolean') {
    issues.push({
      field: 'isFailure',
      code: 'invalid_is_failure',
      message: '« isFailure » doit être un booléen.',
    });
  }

  if (s.notes !== undefined && typeof s.notes !== 'string') {
    issues.push({
      field: 'notes',
      code: 'invalid_notes',
      message: 'Les notes doivent être du texte.',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Contrôles dépendants de l'exercice parent
// ---------------------------------------------------------------------------

/** Les seules mesures dont la validité dépend de l'exercice. */
export type SetMeasures = Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>;

const MEASURE_LABELS: Record<keyof SetMeasures, string> = {
  weightKg: 'une charge',
  reps: 'des répétitions',
  durationSec: 'une durée',
};

/**
 * Vérifie que les mesures présentes correspondent à ce que l'exercice attend.
 * C'est ici que se joue le cas « poids du corps » et le cas « au temps ».
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
        message: `« ${exercise.name} » attend ${MEASURE_LABELS[field]}.`,
      });
    }

    if (required[field] === 'forbidden' && isPresent) {
      issues.push({
        field,
        code: 'field_forbidden',
        message: `« ${exercise.name} » n'attend pas ${MEASURE_LABELS[field]}.`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Façades
// ---------------------------------------------------------------------------

/** Tous les contrôles. Destiné à l'UI, qui veut la liste et non une exception. */
export function validateSet(set: SetEntry, exercise: ExerciseRules): ValidationIssue[] {
  return [...checkSetShape(set), ...checkSetAgainstExercise(set, exercise)];
}

/** Variante levante, utilisée par les hooks Dexie (abandonne la transaction). */
export function assertSetShape(value: unknown): void {
  const issues = checkSetShape(value);
  if (issues.length > 0) throw new SetValidationError(issues);
}

/** Variante levante complète, utilisée par la couche d'écriture. */
export function assertValidSet(set: SetEntry, exercise: ExerciseRules): void {
  const issues = validateSet(set, exercise);
  if (issues.length > 0) throw new SetValidationError(issues);
}
