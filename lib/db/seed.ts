/**
 * Catalogue shipped with the app, inserted once when the database is created
 * (`on('populate')`).
 *
 * Deliberately short: enough to log a first set without creating anything by
 * hand. It mostly covers the **four load types and both metrics**, so every
 * branch of the validation has a real case.
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
