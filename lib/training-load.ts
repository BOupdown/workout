/**
 * What a stretch of training added up to, per muscle.
 *
 * The question this answers is the one a programme is actually steered by:
 * *how many sets of back did I do this week*. Not how heavy the best one was —
 * that is the progression curve, and it says nothing about whether a muscle was
 * trained at all. Fourteen sets of back and two of legs is a plan going wrong,
 * and no screen in the app could show it.
 *
 * Pure, and fed with rows the caller has already read: exactly like
 * `buildProgression`, and for the same reason — every rule below is worth a
 * test, and none of them needs a database to be checked.
 */

import type { Exercise, Id, MuscleGroup, SetEntry } from './db/types';
import { MUSCLE_GROUP_ORDER } from './exercise-groups';

/** One muscle's share of the period. `group` is `null` when none was recorded. */
export interface MuscleGroupLoad {
  group: MuscleGroup | null;
  /** Work sets. Every one of them, whatever the exercise is loaded with. */
  workSets: number;
  /** Σ load × reps, over the sets that have one. See `isLoadedForVolume`. */
  volumeKg: number;
}

export interface TrainingLoad {
  /** Work sets over the whole period. Warm-ups are not in it. */
  workSets: number;
  volumeKg: number;
  /** Muscles that were trained, in the app's anatomical order. */
  byGroup: MuscleGroupLoad[];
}

export const EMPTY_LOAD: TrainingLoad = { workSets: 0, volumeKg: 0, byGroup: [] };

/**
 * Whether a set contributes a tonnage.
 *
 * `external` only, and the exclusions are the same ones the plate calculator
 * and the 1RM estimate make, for the same reason: the number in `weightKg`
 * does not mean the same thing across load types.
 *
 * A weighted pull-up records the belt, and the body it was hanging from is not
 * in the row — it lives on its own dated timeline and may be missing entirely,
 * so counting it would make the week's tonnage depend on whether you stood on a
 * scale. An assisted rep records weight *removed*: adding it would credit the
 * machine. Bodyweight work records nothing to multiply.
 *
 * Those sets still count in `workSets`, which is the metric this screen leads
 * with. Only the tonnage is silent about them.
 */
function isLoadedForVolume(exercise: Pick<Exercise, 'loadType' | 'metric'>): boolean {
  return exercise.loadType === 'external' && exercise.metric === 'reps';
}

/**
 * Totals a list of sets, one bucket per muscle.
 *
 * A set whose exercise cannot be resolved is **counted, without a muscle**. The
 * alternative is dropping it, and then the muscle rows no longer add up to the
 * total printed above them — a screen quietly disagreeing with itself is worse
 * than a row labelled "Other". The same holds for an exercise that simply has
 * no `muscleGroup`: it is optional on the model, and a custom exercise created
 * in a hurry has none.
 */
export function summariseTrainingLoad(
  sets: SetEntry[],
  exerciseById: Map<Id, Exercise>,
): TrainingLoad {
  const byGroup = new Map<MuscleGroup | null, MuscleGroupLoad>();
  let workSets = 0;
  let volumeKg = 0;

  for (const set of sets) {
    // Warm-ups are out, as they are out of the curve and the records: a ramp-up
    // is not a set of back, it is the price of the first one.
    if (set.kind !== 'work') continue;

    const exercise = exerciseById.get(set.exerciseId);
    const group = exercise?.muscleGroup ?? null;

    const volume =
      exercise &&
      isLoadedForVolume(exercise) &&
      set.weightKg !== undefined &&
      set.reps !== undefined
        ? set.weightKg * set.reps
        : 0;

    workSets += 1;
    volumeKg += volume;

    const bucket = byGroup.get(group);
    if (bucket) {
      bucket.workSets += 1;
      bucket.volumeKg += volume;
    } else {
      byGroup.set(group, { group, workSets: 1, volumeKg: volume });
    }
  }

  const rounded = [...byGroup.values()].map((load) => ({
    ...load,
    volumeKg: round(load.volumeKg),
  }));

  return { workSets, volumeKg: round(volumeKg), byGroup: inAnatomicalOrder(rounded) };
}

/**
 * Anatomical order, the one the catalogue and the picker already use, with the
 * muscle-less bucket last.
 *
 * Not sorted by set count. A ranking would reshuffle the rows every week, and
 * comparing this week with last week is the entire point — you cannot read two
 * lists against each other when neither keeps its shape.
 */
function inAnatomicalOrder<T extends { group: MuscleGroup | null }>(rows: T[]): T[] {
  const byGroup = new Map(rows.map((row) => [row.group, row]));
  const ordered: T[] = [];

  for (const group of MUSCLE_GROUP_ORDER) {
    const found = byGroup.get(group);
    if (found) ordered.push(found);
  }

  const ungrouped = byGroup.get(null);
  if (ungrouped) ordered.push(ungrouped);

  return ordered;
}

/** Tonnage to the tenth: 87.5 × 3 must not read 262.50000000000003. */
const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The two weeks laid over each other, so a muscle that disappeared is still a
 * row.
 *
 * The reading that matters is not "fourteen sets of back" on its own — it is
 * fourteen against last week's eight, and above all **legs against last week's
 * twelve and this week's nothing**. A group that dropped to zero is the one the
 * screen exists to show, and it is exactly the one a list built from this week
 * alone cannot contain.
 */
export interface MuscleGroupComparison extends MuscleGroupLoad {
  /** The same muscle's work sets over the previous period. */
  previousWorkSets: number;
}

export function compareTrainingLoad(
  current: TrainingLoad,
  previous: TrainingLoad,
): MuscleGroupComparison[] {
  const merged = new Map<MuscleGroup | null, MuscleGroupComparison>();

  for (const load of current.byGroup) {
    merged.set(load.group, { ...load, previousWorkSets: 0 });
  }

  for (const load of previous.byGroup) {
    const row = merged.get(load.group);
    if (row) row.previousWorkSets = load.workSets;
    // Trained then, not now. A zero row, placed anatomically like any other
    // rather than appended to the end as an afterthought.
    else merged.set(load.group, { ...load, workSets: 0, volumeKg: 0, previousWorkSets: load.workSets });
  }

  return inAnatomicalOrder([...merged.values()]);
}
