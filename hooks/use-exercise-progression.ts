'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { recentSetsForExercise } from '@/lib/db/sets';
import type { Exercise, SetEntry } from '@/lib/db/types';
import {
  buildProgression,
  progressionDelta,
  progressionMetric,
  type ProgressionMetric,
  type SessionPoint,
} from '@/lib/progression';

/** Séances remontées. Au-delà, la courbe devient illisible sur 375 px. */
const MAX_SETS = 200;

export interface ExerciseProgression {
  loading: boolean;
  points: SessionPoint[];
  metric: ProgressionMetric;
  /** Écart avec la séance précédente, `null` s'il n'y a pas de quoi comparer. */
  delta: number | null;
  /** Séries de travail les plus récentes, pour le tableau sous le graphique. */
  recentSets: SetEntry[];
}

/**
 * Progression d'un exercice, réactualisée automatiquement.
 *
 * Une seule requête, sur l'index `[exerciseId+performedAt+order]` : c'est
 * exactement ce pour quoi il a été posé. Le regroupement par séance se fait en
 * mémoire, sur une queue bornée.
 */
export function useExerciseProgression(exercise: Exercise | undefined): ExerciseProgression {
  const sets = useLiveQuery(
    () => (exercise ? recentSetsForExercise(exercise.id, MAX_SETS) : undefined),
    [exercise?.id],
  );

  const metric = exercise ? progressionMetric(exercise) : 'weightKg';

  if (!exercise || sets === undefined) {
    return { loading: true, points: [], metric, delta: null, recentSets: [] };
  }

  // `recentSetsForExercise` rend l'ordre antéchronologique ; la progression se
  // lit dans l'autre sens.
  const points = buildProgression(sets, exercise);

  return {
    loading: false,
    points,
    metric,
    delta: progressionDelta(points),
    recentSets: sets,
  };
}
