/**
 * Draft state for creating a custom exercise.
 *
 * Same doctrine as `./set-draft`: values stay strings while the user types, and
 * the form cannot produce an exercise the database would reject — a field that
 * makes no sense for the chosen nature is not displayed, so its value is never
 * emitted.
 */

import type { ExerciseUpdate, NewExerciseInput } from './db/exercises';
import type { EffortMetric, Exercise, LoadType, MuscleGroup } from './db/types';
import { formatNumber, parseNumberInput } from './format';

export interface ExerciseDraft {
  name: string;
  loadType: LoadType;
  metric: EffortMetric;
  perSide: boolean;
  /** Empty string = not set. */
  muscleGroup: MuscleGroup | '';
  defaultIncrementKg: string;
}

export const EMPTY_EXERCISE_DRAFT: ExerciseDraft = {
  name: '',
  loadType: 'external',
  metric: 'reps',
  perSide: false,
  muscleGroup: '',
  defaultIncrementKg: '',
};

/**
 * Labels in gym language. "loadType" and "metric" are data-model jargon: nobody
 * picks a "weighted_bodyweight".
 */
export const LOAD_TYPE_OPTIONS: { value: LoadType; label: string; hint: string }[] = [
  { value: 'external', label: 'With a load', hint: 'barbell, dumbbells, machine' },
  { value: 'bodyweight', label: 'Bodyweight', hint: 'no load to enter' },
  { value: 'weighted_bodyweight', label: 'Bodyweight + added', hint: 'belt, weight vest' },
  { value: 'assisted', label: 'Assisted', hint: 'machine or band that lightens you' },
];

export const METRIC_OPTIONS: { value: EffortMetric; label: string }[] = [
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
];

/** A `Record`, not an array: adding a group without naming it will not compile. */
export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  fullbody: 'Full body',
  cardio: 'Cardio',
};

/**
 * A progression step only exists when there is a load to increment. The
 * validation refuses it for bodyweight, so the form does not show it.
 */
export function draftAllowsIncrement(draft: Pick<ExerciseDraft, 'loadType'>): boolean {
  return draft.loadType !== 'bodyweight';
}

/**
 * Converts the draft into a `createExercise` input.
 *
 * An empty or unreadable field is **omitted**, never guessed: the database
 * validation then produces its typed message, the single source of truth.
 */
export function exerciseDraftToInput(draft: ExerciseDraft): NewExerciseInput {
  const input: NewExerciseInput = {
    name: draft.name.trim(),
    loadType: draft.loadType,
    metric: draft.metric,
    perSide: draft.perSide,
  };

  if (draft.muscleGroup !== '') input.muscleGroup = draft.muscleGroup;

  if (draftAllowsIncrement(draft)) {
    const increment = parseNumberInput(draft.defaultIncrementKg);
    if (increment !== null) input.defaultIncrementKg = increment;
  }

  return input;
}

/** Fills a draft from an exercise already saved, to edit it. */
export function exerciseToDraft(exercise: Exercise): ExerciseDraft {
  return {
    name: exercise.name,
    loadType: exercise.loadType,
    metric: exercise.metric,
    perSide: exercise.perSide,
    muscleGroup: exercise.muscleGroup ?? '',
    defaultIncrementKg:
      exercise.defaultIncrementKg !== undefined ? formatNumber(exercise.defaultIncrementKg) : '',
  };
}

/**
 * Converts the draft into an `updateExercise` patch.
 *
 * Optional fields are always **present**, set to `undefined` when empty, which
 * `Table.update` reads as "remove this key". Omitting them would instead mean
 * "leave as is" — and clearing a muscle group would become impossible.
 *
 * The nature fields are sent back even when untouched: `updateExercise` only
 * counts *effective* changes, so an unchanged value is a no-op rather than a
 * rejection.
 */
export function exerciseDraftToUpdate(draft: ExerciseDraft): ExerciseUpdate {
  const increment = draftAllowsIncrement(draft)
    ? parseNumberInput(draft.defaultIncrementKg)
    : null;

  return {
    name: draft.name.trim(),
    loadType: draft.loadType,
    metric: draft.metric,
    perSide: draft.perSide,
    muscleGroup: draft.muscleGroup === '' ? undefined : draft.muscleGroup,
    defaultIncrementKg: increment ?? undefined,
  };
}

/** Reduced view of an existing exercise, to offer reusing it. */
export type ConflictingExercise = Pick<Exercise, 'id' | 'name' | 'archivedAt'>;
