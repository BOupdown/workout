/**
 * Validation des invariants de `Session` et `SessionExercise`.
 *
 * Même découpage que pour les séries : ce qui se vérifie sans lecture part dans
 * les hooks Dexie, ce qui demande de lire une autre entité reste dans la couche
 * transactionnelle (`../sessions`).
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

/** Garde-fous de saisie, même logique que `SET_LIMITS`. */
export const SESSION_LIMITS = {
  maxBodyweightKg: 700,
} as const;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Invariants structurels d'une séance.
 *
 * Note : on vérifie le **format** de `date` mais pas sa cohérence avec
 * `startedAt`. `date` est figée à la création, dans le fuseau de l'utilisateur
 * d'alors ; exiger qu'elle corresponde toujours au jour local de `startedAt`
 * casserait toute séance saisie avant un changement de fuseau.
 */
export function checkSessionShape(value: unknown): ValidationIssue[] {
  const s = asRecord(value);
  if (!s) return [notAnObjectIssue('La séance')];

  const issues: ValidationIssue[] = [];

  if (!isId(s.id)) {
    issues.push({
      field: 'id',
      code: 'invalid_id',
      message: '« id » doit être un identifiant non vide.',
    });
  }

  for (const field of ['startedAt', 'createdAt'] as const) {
    if (!isTimestamp(s[field])) {
      issues.push({
        field,
        code: 'invalid_timestamp',
        message: `« ${field} » doit être un timestamp positif.`,
      });
    }
  }

  if (!isLocalDate(s.date)) {
    issues.push({
      field: 'date',
      code: 'invalid_date',
      message: '« date » doit être un jour réel au format AAAA-MM-JJ.',
    });
  }

  if (s.endedAt !== undefined) {
    if (!isTimestamp(s.endedAt)) {
      issues.push({
        field: 'endedAt',
        code: 'invalid_timestamp',
        message: '« endedAt » doit être un timestamp positif.',
      });
    } else if (isTimestamp(s.startedAt) && s.endedAt < s.startedAt) {
      // Structurel : les deux champs sont sur la même ligne, aucune lecture.
      issues.push({
        field: 'endedAt',
        code: 'ends_before_start',
        message: 'Une séance ne peut pas se terminer avant d’avoir commencé.',
      });
    }
  }

  if (s.bodyweightKg !== undefined) {
    if (!isNumber(s.bodyweightKg) || s.bodyweightKg <= 0) {
      issues.push({
        field: 'bodyweightKg',
        code: 'invalid_bodyweight',
        message: 'Le poids de corps doit être un nombre strictement positif, en kg.',
      });
    } else if (s.bodyweightKg > SESSION_LIMITS.maxBodyweightKg) {
      issues.push({
        field: 'bodyweightKg',
        code: 'bodyweight_out_of_range',
        message: `Le poids de corps ne peut pas dépasser ${SESSION_LIMITS.maxBodyweightKg} kg.`,
      });
    }
  }

  for (const field of ['title', 'notes'] as const) {
    if (s[field] !== undefined && typeof s[field] !== 'string') {
      issues.push({
        field,
        code: 'invalid_text',
        message: `« ${field} » doit être du texte.`,
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
  if (!b) return [notAnObjectIssue('L’exercice de la séance')];

  const issues: ValidationIssue[] = [];

  for (const field of ['id', 'sessionId', 'exerciseId'] as const) {
    if (!isId(b[field])) {
      issues.push({
        field,
        code: 'invalid_id',
        message: `« ${field} » doit être un identifiant non vide.`,
      });
    }
  }

  if (!isNonNegativeInteger(b.order)) {
    issues.push({
      field: 'order',
      code: 'invalid_order',
      message: '« order » doit être un entier positif ou nul.',
    });
  }

  if (b.supersetGroup !== undefined && !isNonNegativeInteger(b.supersetGroup)) {
    issues.push({
      field: 'supersetGroup',
      code: 'invalid_superset_group',
      message: '« supersetGroup » doit être un entier positif ou nul.',
    });
  }

  if (b.notes !== undefined && typeof b.notes !== 'string') {
    issues.push({
      field: 'notes',
      code: 'invalid_notes',
      message: 'Les notes doivent être du texte.',
    });
  }

  return issues;
}

export function assertSessionExerciseShape(value: unknown): void {
  const issues = checkSessionExerciseShape(value);
  if (issues.length > 0) throw new SessionExerciseValidationError(issues);
}

/**
 * Contrôle contextuel : un exercice archivé ne peut pas être ajouté à une
 * séance. C'est tout l'intérêt de l'archivage — sortir un mouvement du
 * sélecteur sans toucher à l'historique déjà saisi.
 */
export function assertExerciseSelectable(exercise: Pick<Exercise, 'name' | 'archivedAt'>): void {
  if (exercise.archivedAt !== undefined) {
    throw new SessionExerciseValidationError([
      {
        field: 'exerciseId',
        code: 'exercise_archived',
        message: `« ${exercise.name} » est archivé et ne peut pas être ajouté à une séance.`,
      },
    ]);
  }
}
