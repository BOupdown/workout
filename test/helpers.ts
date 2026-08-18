import { db } from '../lib/db/db';
import type { Exercise } from '../lib/db/types';

/**
 * Détruit puis recrée la base, ce qui rejoue `on('populate')` et rend donc le
 * catalogue de départ à chaque test. La couche d'écriture importe le singleton
 * `db` : on réinitialise cette instance plutôt que d'en fabriquer une autre.
 */
export async function resetDatabase(): Promise<void> {
  if (db.isOpen()) db.close();
  await db.delete();
  await db.open();
}

/** Exercice du catalogue, par son `nameKey`. Lève si absent, pour un échec net. */
export async function exerciseByKey(nameKey: string): Promise<Exercise> {
  const exercise = await db.exercises.where('nameKey').equals(nameKey).first();
  if (!exercise) throw new Error(`Exercice absent du catalogue de départ : ${nameKey}`);
  return exercise;
}

/** Les quatre exercices de référence, un par branche de la validation. */
export async function referenceExercises() {
  const [squat, pompes, gainage, traction] = await Promise.all([
    exerciseByKey('squat'), // external + reps
    exerciseByKey('pompes'), // bodyweight + reps
    exerciseByKey('gainage planche'), // bodyweight + time
    exerciseByKey('traction'), // weighted_bodyweight + reps
  ]);
  return { squat, pompes, gainage, traction };
}
