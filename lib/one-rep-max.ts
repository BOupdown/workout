/**
 * What a set says about the single you never did.
 *
 * The problem it exists to solve: the progression curve plots the load of the
 * best work set, which is a fact, but not always a comparison. Ten reps at 60
 * followed by five at 65 draws a rise, and it may well be a fall — fewer reps
 * for slightly more weight is often less work, not more. Load and reps are two
 * numbers and the question "am I stronger than last month" wants one.
 *
 * An estimated one-rep max is that one number. It is also, unavoidably, a
 * **model**: nothing here was measured, and the app is otherwise built on the
 * principle that what it shows was performed. That is why this never replaces
 * the measured curve — it sits beside it, behind a switch, and says so.
 */

import type { Exercise } from './db/types';

/**
 * Past this many reps, no estimate is offered.
 *
 * The formula below was fitted on sets in the range strength work actually
 * lives in. Run it out to a set of twenty and it returns a confident number
 * that is simply wrong — and a wrong estimate is worse than a missing one,
 * because a gap in the curve invites a look at the set while a bad point
 * invites a training decision.
 */
export const MAX_ESTIMABLE_REPS = 12;

/**
 * Brzycki: `1RM = w × 36 / (37 − r)`.
 *
 * Chosen over Epley (`w × (1 + r/30)`) for two reasons. It is **exact at one
 * rep** — a single at 100 estimates 100, where Epley reports 103.3 and has to
 * be special-cased. And below ten reps, the range this app is used in, it sits
 * closer to what people actually test. Above that the two diverge and Brzycki
 * degrades faster, which is what `MAX_ESTIMABLE_REPS` is for; the ceiling is
 * the answer to that, not a second formula.
 *
 * One formula, not a preference. Two would drift the whole curve the day it was
 * switched, and a history that changes shape because of a setting is worse than
 * one computed by a rule that is merely arguable.
 *
 * Returns `null` rather than a number whenever the estimate would be
 * meaningless — outside the rep range, or with no load to scale.
 */
export function estimateOneRepMaxKg(weightKg: number, reps: number): number | null {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;

  // A set logged at 0 on a barbell exercise is the empty bar. There is a real
  // performance in there, and no load for the formula to multiply.
  if (weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_ESTIMABLE_REPS) return null;

  // Rounded to a tenth of a kilo, deliberately: this is an estimate, and
  // carrying it to the gram would dress a model up as a measurement.
  return Math.round(((weightKg * 36) / (37 - reps)) * 10) / 10;
}

/**
 * Whether an estimate means anything for this exercise.
 *
 * `external` reps only, and each exclusion is a different kind of nonsense:
 *
 *   `bodyweight`        no load to scale — the set carries none.
 *   `weighted_bodyweight`  `weightKg` is what was *added*. The load that was
 *                       actually moved is bodyweight plus the belt, and the set
 *                       does not record the first half of that — it lives on
 *                       its own dated timeline and may simply be absent. An
 *                       estimate off the belt alone is a number about nothing.
 *   `assisted`          the load is weight *removed*. More of it means weaker,
 *                       so the formula would run backwards and report progress
 *                       for a set that needed more help.
 *   `metric: 'time'`    no reps.
 */
export function supportsOneRepMax(exercise: Pick<Exercise, 'loadType' | 'metric'>): boolean {
  return exercise.loadType === 'external' && exercise.metric === 'reps';
}
