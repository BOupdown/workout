import { db } from '../lib/db/db';
import type { Exercise } from '../lib/db/types';

/**
 * Destroys then recreates the database, which replays `on('populate')` and so
 * restores the starting catalogue for every test. The write layer imports the
 * `db` singleton, so we reset that instance rather than build another.
 */
export async function resetDatabase(): Promise<void> {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

/** A catalogue exercise by `nameKey`. Throws if missing, for a clean failure. */
export async function exerciseByKey(nameKey: string): Promise<Exercise> {
  const exercise = await db.exercises.where('nameKey').equals(nameKey).first();
  if (!exercise) throw new Error(`Exercise missing from the starting catalogue: ${nameKey}`);
  return exercise;
}

/** The four reference exercises, one per branch of the validation. */
export async function referenceExercises() {
  const [squat, pushUps, plank, pullUp] = await Promise.all([
    exerciseByKey('squat'), // external + reps
    exerciseByKey('push ups'), // bodyweight + reps
    exerciseByKey('plank'), // bodyweight + time
    exerciseByKey('pull up'), // weighted_bodyweight + reps
  ]);
  return { squat, pushUps, plank, pullUp };
}
