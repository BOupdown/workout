/**
 * Catalogue shipped with the app, inserted once when the database is created
 * (`on('populate')`).
 *
 * Wide enough that most people find what they came to do without creating
 * anything by hand, and still curated: a picker nobody can scan is worse than
 * one that is missing an exercise, since the missing one takes ten seconds to
 * add and a bloated list costs a search every session.
 *
 * It also covers the **four load types and both metrics**, so every branch of
 * the validation has a real case.
 *
 * Adding to this list only reaches new installs — `on('populate')` runs once.
 * Existing databases get them through the upgrade in `./db`.
 */

import { newId, toNameKey } from './keys';
import type { Exercise } from './types';

type SeedExercise = Omit<Exercise, 'id' | 'nameKey' | 'isCustom' | 'createdAt'>;

const SEED: SeedExercise[] = [
  // --- External load, counted in reps ------------------------------------
  { name: 'Squat', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 2.5 },
  { name: 'Deadlift', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'hamstrings', defaultIncrementKg: 5 },
  { name: 'Bench press', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 2.5 },
  { name: 'Overhead press', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 2.5 },
  { name: 'Barbell row', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Dumbbell press', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 2 },
  { name: 'One-arm dumbbell row', loadType: 'external', metric: 'reps', perSide: true, muscleGroup: 'back', defaultIncrementKg: 2 },
  { name: 'Walking lunges', loadType: 'external', metric: 'reps', perSide: true, muscleGroup: 'quads', defaultIncrementKg: 2 },
  { name: 'Leg press', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 5 },
  { name: 'Leg curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'hamstrings', defaultIncrementKg: 2.5 },
  { name: 'Lat pulldown', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Dumbbell curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'biceps', defaultIncrementKg: 1 },
  { name: 'Triceps pushdown', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 1 },
  { name: 'Lateral raises', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 1 },
  { name: 'Standing calf raise', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'calves', defaultIncrementKg: 2.5 },

  // --- Bodyweight, plus any added load ------------------------------------
  // `weighted_bodyweight` rather than `bodyweight`: the load may be 0, which
  // lets progression continue the day a belt goes on.
  { name: 'Pull-up', loadType: 'weighted_bodyweight', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Dips', loadType: 'weighted_bodyweight', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 2.5 },

  // --- Assisted (the load *removes* weight) --------------------------------
  { name: 'Assisted pull-up', loadType: 'assisted', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 5 },

  // --- Bodyweight only ------------------------------------------------------
  { name: 'Push-ups', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'chest' },
  { name: 'Crunch', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'core' },

  // --- Counted in time ------------------------------------------------------
  { name: 'Plank', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'core' },
  { name: 'Dead hang', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'forearms' },
  { name: 'Jump rope', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'cardio' },

  // --- Added later, on the same rules --------------------------------------
  { name: 'Incline bench press', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 2.5 },
  { name: 'Close-grip bench press', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 2.5 },
  { name: 'Cable fly', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 1 },
  { name: 'Pec deck', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'chest', defaultIncrementKg: 2.5 },

  { name: 'Front squat', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 2.5 },
  { name: 'Goblet squat', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 2 },
  { name: 'Romanian deadlift', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'hamstrings', defaultIncrementKg: 2.5 },
  { name: 'Good morning', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'hamstrings', defaultIncrementKg: 2.5 },
  { name: 'Hip thrust', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'glutes', defaultIncrementKg: 5 },
  { name: 'Bulgarian split squat', loadType: 'external', metric: 'reps', perSide: true, muscleGroup: 'quads', defaultIncrementKg: 2 },
  { name: 'Leg extension', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'quads', defaultIncrementKg: 2.5 },
  { name: 'Seated calf raise', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'calves', defaultIncrementKg: 2.5 },

  { name: 'Seated cable row', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'T-bar row', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },
  { name: 'Shrug', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'back', defaultIncrementKg: 2.5 },

  { name: 'Face pull', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 1 },
  { name: 'Rear delt fly', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 1 },
  { name: 'Upright row', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'shoulders', defaultIncrementKg: 1 },

  { name: 'Barbell curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'biceps', defaultIncrementKg: 1 },
  { name: 'Hammer curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'biceps', defaultIncrementKg: 1 },
  { name: 'Preacher curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'biceps', defaultIncrementKg: 1 },
  { name: 'Skull crusher', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 1 },
  { name: 'Overhead triceps extension', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'triceps', defaultIncrementKg: 1 },
  { name: 'Wrist curl', loadType: 'external', metric: 'reps', perSide: false, muscleGroup: 'forearms', defaultIncrementKg: 1 },

  // Chin-up joins Pull-up and Dips: the belt may hold nothing, and zero is a
  // real answer rather than a missing one.
  { name: 'Chin-up', loadType: 'weighted_bodyweight', metric: 'reps', perSide: false, muscleGroup: 'biceps', defaultIncrementKg: 2.5 },

  { name: 'Inverted row', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'back' },
  { name: 'Hanging leg raise', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'core' },
  { name: 'Ab wheel rollout', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'core' },
  { name: 'Back extension', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'hamstrings' },
  { name: 'Glute bridge', loadType: 'bodyweight', metric: 'reps', perSide: false, muscleGroup: 'glutes' },

  // Held rather than counted, and one of them a side at a time.
  { name: 'Side plank', loadType: 'bodyweight', metric: 'time', perSide: true, muscleGroup: 'core' },
  { name: 'Wall sit', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'quads' },
  { name: 'Running', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'cardio' },
  { name: 'Cycling', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'cardio' },
  { name: 'Rowing machine', loadType: 'bodyweight', metric: 'time', perSide: false, muscleGroup: 'cardio' },
];

/**
 * Renames applied to databases seeded before the app moved to English.
 *
 * Keyed by the old normalised name. Exercises the user created are never
 * touched — only the ones shipped with the app.
 */
export const CATALOGUE_RENAMES: Record<string, string> = {
  'souleve de terre': 'Deadlift',
  'developpe couche': 'Bench press',
  'developpe militaire': 'Overhead press',
  'rowing barre': 'Barbell row',
  'developpe halteres': 'Dumbbell press',
  'rowing haltere unilateral': 'One-arm dumbbell row',
  'fentes marchees': 'Walking lunges',
  'presse a cuisses': 'Leg press',
  'tirage vertical': 'Lat pulldown',
  'curl biceps halteres': 'Dumbbell curl',
  'extension triceps a la poulie': 'Triceps pushdown',
  'elevations laterales': 'Lateral raises',
  'mollets debout': 'Standing calf raise',
  traction: 'Pull-up',
  'traction assistee': 'Assisted pull-up',
  pompes: 'Push-ups',
  'gainage planche': 'Plank',
  'suspension a la barre': 'Dead hang',
  'corde a sauter': 'Jump rope',
};

/** Builds the catalogue rows, with ids and `nameKey` derived. */
export function buildSeedExercises(now: number = Date.now()): Exercise[] {
  return SEED.map((exercise) => ({
    ...exercise,
    id: newId(),
    nameKey: toNameKey(exercise.name),
    isCustom: false,
    createdAt: now,
  }));
}
