import type { Exercise, MuscleGroup } from './db/types';
import { MUSCLE_GROUP_LABELS } from './exercise-draft';

/**
 * The order muscle groups are shown in.
 *
 * Anatomical rather than alphabetical: someone looking for a row scans the
 * upper body and stops, where an A-to-Z list would sit "back" between "arms"
 * and "calves" and make them read all of it.
 *
 * Separate from `MUSCLE_GROUP_LABELS` because a `Record` guarantees every group
 * is *named*, not that it is *placed*. A test holds the two in step.
 */
export const MUSCLE_GROUP_ORDER: readonly MuscleGroup[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'fullbody',
  'cardio',
];

/** Exercises with no group of their own, kept last rather than hidden. */
export const UNGROUPED_LABEL = 'Other';

export interface ExerciseSection {
  /** `null` for exercises with no muscle group recorded. */
  group: MuscleGroup | null;
  label: string;
  exercises: Exercise[];
}

/**
 * Splits a flat catalogue into sections by muscle group.
 *
 * The catalogue grew to a size where a single alphabetical column stopped
 * being a list and became a wall: "biceps curl" and "bicycle" next to each
 * other tells you nothing about what you came to train.
 *
 * Order within a section is whatever came in — callers already read the
 * catalogue sorted by name, and re-sorting here would silently override that.
 * Empty sections are dropped rather than rendered as headers with nothing
 * under them, so deleting the last chest exercise removes the heading too.
 *
 * `muscleGroup` is optional on `Exercise`, so anything without one lands in a
 * trailing section. Dropping those would hide a custom exercise from the very
 * screen used to find it.
 */
export function groupByMuscle(exercises: Exercise[]): ExerciseSection[] {
  const byGroup = new Map<MuscleGroup, Exercise[]>();
  const ungrouped: Exercise[] = [];

  for (const exercise of exercises) {
    if (exercise.muscleGroup === undefined) {
      ungrouped.push(exercise);
      continue;
    }

    const bucket = byGroup.get(exercise.muscleGroup);
    if (bucket) bucket.push(exercise);
    else byGroup.set(exercise.muscleGroup, [exercise]);
  }

  const sections: ExerciseSection[] = [];

  for (const group of MUSCLE_GROUP_ORDER) {
    const found = byGroup.get(group);
    if (found === undefined) continue;

    sections.push({ group, label: MUSCLE_GROUP_LABELS[group], exercises: found });
  }

  if (ungrouped.length > 0) {
    sections.push({ group: null, label: UNGROUPED_LABEL, exercises: ungrouped });
  }

  return sections;
}
