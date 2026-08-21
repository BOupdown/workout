/**
 * Validation of `TrainingBlock`.
 *
 * The label is free text on purpose — the app encodes no methodology — so the
 * only thing worth guarding is that it is text, and not an empty one: a block
 * with no name is a coloured band nobody can identify.
 */

import { isLocalDate } from '../keys';
import {
  asRecord,
  isId,
  isTimestamp,
  notAnObjectIssue,
  SessionValidationError,
  type ValidationIssue,
} from './common';

/** Long enough for "Prépa compétition novembre", short enough to render. */
export const MAX_BLOCK_LABEL = 60;

export function checkTrainingBlockShape(value: unknown): ValidationIssue[] {
  const b = asRecord(value);
  if (!b) return [notAnObjectIssue('training block')];

  const issues: ValidationIssue[] = [];

  if (!isId(b.id)) {
    issues.push({ field: 'id', code: 'invalid_id', message: 'Invalid identifier.' });
  }

  if (typeof b.label !== 'string' || b.label.trim() === '') {
    issues.push({
      field: 'label',
      code: 'invalid_label',
      message: 'A block needs a name.',
    });
  } else if (b.label.length > MAX_BLOCK_LABEL) {
    issues.push({
      field: 'label',
      code: 'label_too_long',
      message: `A block name cannot exceed ${MAX_BLOCK_LABEL} characters.`,
    });
  }

  if (!isLocalDate(b.startsOn)) {
    issues.push({
      field: 'startsOn',
      code: 'invalid_date',
      message: 'Start date must be formatted YYYY-MM-DD.',
    });
  }

  if (!isTimestamp(b.createdAt)) {
    issues.push({
      field: 'createdAt',
      code: 'invalid_timestamp',
      message: '“createdAt” must be a positive timestamp.',
    });
  }

  return issues;
}

export function assertTrainingBlockShape(value: unknown): void {
  const issues = checkTrainingBlockShape(value);
  if (issues.length > 0) throw new SessionValidationError(issues);
}
