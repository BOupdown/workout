/**
 * Validation des invariants d'`Exercise`.
 *
 * Tout y est structurel : un exercice ne dépend d'aucune autre entité. Les
 * règles qui, elles, dépendent de la base — unicité de `nameKey`, présence de
 * séries déjà saisies — vivent dans la couche transactionnelle `../exercises`.
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
 * Tables d'appartenance déclarées en `Record<Union, true>` plutôt qu'en tableau :
 * ajouter un membre à l'union sans l'ajouter ici devient une erreur de
 * compilation. Un simple tableau ne détecterait que les valeurs en trop.
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
  if (!e) return [notAnObjectIssue('L’exercice')];

  const issues: ValidationIssue[] = [];

  if (!isId(e.id)) {
    issues.push({
      field: 'id',
      code: 'invalid_id',
      message: '« id » doit être un identifiant non vide.',
    });
  }

  const hasUsableName = typeof e.name === 'string' && e.name.trim().length > 0;
  if (!hasUsableName) {
    issues.push({
      field: 'name',
      code: 'invalid_name',
      message: 'Le nom de l’exercice ne peut pas être vide.',
    });
  } else if ((e.name as string).length > EXERCISE_LIMITS.maxNameLength) {
    issues.push({
      field: 'name',
      code: 'name_too_long',
      message: `Le nom ne peut pas dépasser ${EXERCISE_LIMITS.maxNameLength} caractères.`,
    });
  }

  // Invariant fort, et vérifiable sans lecture puisque les deux champs sont sur
  // la même ligne : `nameKey` est *toujours* la normalisation de `name`. C'est
  // ce qui empêche de contourner l'index unique `&nameKey` avec un couple
  // incohérent, et donc de fragmenter l'historique d'un même mouvement.
  if (hasUsableName) {
    const expected = toNameKey(e.name as string);
    if (e.nameKey !== expected) {
      issues.push({
        field: 'nameKey',
        code: 'name_key_mismatch',
        message: `« nameKey » doit valoir « ${expected} », dérivé de « ${e.name as string} ».`,
      });
    }
  } else if (!isId(e.nameKey)) {
    issues.push({
      field: 'nameKey',
      code: 'invalid_name_key',
      message: '« nameKey » doit être une clé non vide.',
    });
  }

  if (!isLoadType(e.loadType)) {
    issues.push({
      field: 'loadType',
      code: 'invalid_load_type',
      message: `« loadType » doit valoir ${Object.keys(LOAD_TYPES).join(', ')}.`,
    });
  }

  if (!isEffortMetric(e.metric)) {
    issues.push({
      field: 'metric',
      code: 'invalid_metric',
      message: `« metric » doit valoir ${Object.keys(METRICS).join(' ou ')}.`,
    });
  }

  for (const field of ['perSide', 'isCustom'] as const) {
    if (typeof e[field] !== 'boolean') {
      issues.push({
        field,
        code: 'invalid_flag',
        message: `« ${field} » doit être un booléen.`,
      });
    }
  }

  if (!isTimestamp(e.createdAt)) {
    issues.push({
      field: 'createdAt',
      code: 'invalid_timestamp',
      message: '« createdAt » doit être un timestamp positif.',
    });
  }

  if (e.archivedAt !== undefined && !isTimestamp(e.archivedAt)) {
    issues.push({
      field: 'archivedAt',
      code: 'invalid_timestamp',
      message: '« archivedAt » doit être un timestamp positif.',
    });
  }

  if (e.muscleGroup !== undefined && !isMuscleGroup(e.muscleGroup)) {
    issues.push({
      field: 'muscleGroup',
      code: 'invalid_muscle_group',
      message: '« muscleGroup » n’est pas un groupe musculaire connu.',
    });
  }

  if (e.defaultIncrementKg !== undefined) {
    if (!isNumber(e.defaultIncrementKg) || e.defaultIncrementKg <= 0) {
      issues.push({
        field: 'defaultIncrementKg',
        code: 'invalid_increment',
        message: 'Le pas de progression doit être un nombre strictement positif, en kg.',
      });
    } else if (e.defaultIncrementKg > EXERCISE_LIMITS.maxIncrementKg) {
      issues.push({
        field: 'defaultIncrementKg',
        code: 'increment_out_of_range',
        message: `Le pas de progression ne peut pas dépasser ${EXERCISE_LIMITS.maxIncrementKg} kg.`,
      });
    } else if (e.loadType === 'bodyweight') {
      // Cohérence interne : un exercice au poids du corps n'a pas de champ de
      // charge, donc pas de pas de progression à proposer.
      issues.push({
        field: 'defaultIncrementKg',
        code: 'increment_without_load',
        message: 'Un exercice au poids du corps n’a pas de pas de progression.',
      });
    }
  }

  if (e.notes !== undefined && typeof e.notes !== 'string') {
    issues.push({
      field: 'notes',
      code: 'invalid_notes',
      message: 'Les notes doivent être du texte.',
    });
  }

  return issues;
}

export function assertExerciseShape(value: unknown): void {
  const issues = checkExerciseShape(value);
  if (issues.length > 0) throw new ExerciseValidationError(issues);
}

/** Vue réduite, pour l'UI qui construit un formulaire de création. */
export type ExerciseDraft = Pick<Exercise, 'name' | 'loadType' | 'metric'>;
