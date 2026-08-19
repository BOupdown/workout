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

/** How far back we read. Beyond this the curve is unreadable at 375px. */
const MAX_SETS = 200;

export interface ExerciseProgression {
  loading: boolean;
  points: SessionPoint[];
  metric: ProgressionMetric;
  /** Gap with the previous session, `null` when there is nothing to compare. */
  delta: number | null;
  /** The most recent work sets, for the table under the chart. */
  recentSets: SetEntry[];
}

/**
 * An exercise's progression, kept up to date automatically.
 *
 * A single query over the `[exerciseId+performedAt+order]` index: exactly what
 * it was laid down for. Grouping by session happens in memory, over a bounded
 * tail.
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

  // `recentSetsForExercise` returns reverse-chronological order; progression
  // reads the other way round.
  const points = buildProgression(sets, exercise);

  return {
    loading: false,
    points,
    metric,
    delta: progressionDelta(points),
    recentSets: sets,
  };
}
