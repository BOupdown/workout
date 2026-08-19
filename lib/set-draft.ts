/**
 * Draft state for entering a set.
 *
 * Values are **strings**, not numbers: a field mid-typing holds "102." or "",
 * which no `number` can represent. Conversion happens only on save.
 *
 * Which fields exist is dictated by `setFieldRequirements()`, the same function
 * the validation depends on. That is what makes it structurally impossible to
 * enter a set the database would reject: the screen does not render a forbidden
 * field, so it never produces its value.
 */

import type { NewSetInput } from './db/sets';
import type { Exercise, Id, SetKind } from './db/types';
import { setFieldRequirements, type SetFieldRequirements } from './db/validation';
import { formatNumber, parseNumberInput } from './format';
import { toDisplayWeight, fromDisplayWeight, weightIncrement, type WeightUnit } from './units';

export interface SetDraft {
  weightKg: string;
  reps: string;
  durationSec: string;
}

export type DraftField = keyof SetDraft;

export const EMPTY_DRAFT: SetDraft = { weightKg: '', reps: '', durationSec: '' };

const DRAFT_FIELDS: readonly DraftField[] = ['weightKg', 'reps', 'durationSec'];

/** An exercise reduced to what the draft needs. */
export type DraftExercise = Pick<Exercise, 'loadType' | 'metric' | 'defaultIncrementKg'>;

/** Fields to show, in order, for this exercise. */
export function visibleDraftFields(requirements: SetFieldRequirements): DraftField[] {
  return DRAFT_FIELDS.filter((field) => requirements[field] === 'required');
}

/** Where the pre-filled values come from. */
export type DraftReferenceOrigin =
  /** No reference value available. */
  | 'none'
  /** The previous set of this block — "same again". */
  | 'block'
  /** Another block of the same exercise, in the current session. */
  | 'session'
  /** An earlier session — "pick up where I left off". */
  | 'history';

export interface DraftReference {
  set: SetReference | undefined;
  origin: DraftReferenceOrigin;
}

type SetReference = Partial<Record<DraftField, number>> & { sessionId: Id };

/**
 * Picks the set that supplies the default values.
 *
 * Order matters: the block's last set always wins; failing that we go back to
 * the last work set of this exercise, which may come from another block of the
 * current session as easily as from a past one. The two are told apart so we
 * never announce "last session" about a set logged ten minutes ago.
 */
export function resolveDraftReference(
  block: { sessionId: Id; sets: SetReference[] } | undefined,
  history: SetReference[] | undefined,
): DraftReference {
  if (!block) return { set: undefined, origin: 'none' };

  const lastInBlock = block.sets.at(-1);
  if (lastInBlock) return { set: lastInBlock, origin: 'block' };

  const previous = history?.[0];
  if (!previous) return { set: undefined, origin: 'none' };

  return {
    set: previous,
    origin: previous.sessionId === block.sessionId ? 'session' : 'history',
  };
}

/**
 * Pre-fills the draft from a reference set — the block's previous one, or
 * failing that the exercise's last across all sessions. A field that is not
 * required stays empty: it will not be displayed.
 *
 * The load is converted to the display unit, since that is what the user types.
 */
export function draftFromSet(
  set: Partial<Record<DraftField, number>> | undefined,
  exercise: DraftExercise | undefined,
  unit: WeightUnit = 'kg',
): SetDraft {
  if (!exercise) return EMPTY_DRAFT;

  const requirements = setFieldRequirements(exercise);
  const read = (field: DraftField): string => {
    const value = set?.[field];
    if (requirements[field] !== 'required' || value === undefined) return '';

    return formatNumber(field === 'weightKg' ? toDisplayWeight(value, unit) : value);
  };

  return {
    weightKg: read('weightKg'),
    reps: read('reps'),
    durationSec: read('durationSec'),
  };
}

/**
 * Converts the draft into a `createSet` input.
 *
 * A required but empty or unreadable field is **omitted**, never guessed: the
 * database validation then produces its typed message, the single source of
 * truth. The load goes back to kilograms, the canonical unit.
 */
export function draftToSetInput(
  sessionExerciseId: Id,
  draft: SetDraft,
  exercise: DraftExercise,
  options: { kind?: SetKind; unit?: WeightUnit } = {},
): NewSetInput {
  const requirements = setFieldRequirements(exercise);
  const unit = options.unit ?? 'kg';
  const input: NewSetInput = { sessionExerciseId };

  if (options.kind !== undefined) input.kind = options.kind;

  for (const field of DRAFT_FIELDS) {
    if (requirements[field] !== 'required') continue;

    const parsed = parseNumberInput(draft[field]);
    if (parsed === null) continue;

    input[field] = field === 'weightKg' ? fromDisplayWeight(parsed, unit) : parsed;
  }

  return input;
}

/** Step for the +/- buttons: the load follows the exercise and the unit. */
export function stepForField(
  field: DraftField,
  exercise: DraftExercise,
  unit: WeightUnit = 'kg',
): number {
  if (field === 'weightKg') return weightIncrement(unit, exercise.defaultIncrementKg ?? 2.5);
  if (field === 'durationSec') return 5;
  return 1;
}

/** Applies a step to a field, never below zero. */
export function stepDraftValue(current: string, step: number): string {
  const base = parseNumberInput(current) ?? 0;
  // Re-rounded: 0.1 + 0.2 must not put 0.30000000000000004 in a field.
  const next = Math.max(0, Math.round((base + step) * 1000) / 1000);
  return formatNumber(next);
}
