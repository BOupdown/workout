/**
 * Building an exercise's progression: from the raw list of sets to the drawn
 * curve.
 *
 * Everything is pure and DOM-free - which is what makes these rules testable
 * without rendering.
 *
 * The structural decision: **one quantity on the y axis**. Load and reps share
 * neither scale nor unit; laying them over two axes would invent a correlation
 * absent from the data. The quantity plotted is the one that progresses for
 * this exercise, by exactly the same rules as data entry; reps ride along as an
 * annotation.
 */

import type { Exercise, Id, SetEntry, Timestamp } from './db/types';
import { setFieldRequirements } from './db/validation';

export type ProgressionMetric = 'weightKg' | 'reps' | 'durationSec';

/** The quantity tracked for this exercise, derived from its nature. */
export function progressionMetric(
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): ProgressionMetric {
  const requirements = setFieldRequirements(exercise);
  if (requirements.durationSec === 'required') return 'durationSec';
  if (requirements.weightKg === 'required') return 'weightKg';
  return 'reps';
}

/** A session's best work set, for the tracked quantity. */
export interface SessionPoint {
  sessionId: Id;
  performedAt: Timestamp;
  value: number;
  /** Reps of that set, when the value is a load. */
  reps?: number;
  /** Number of work sets in the session. */
  setCount: number;
}

/**
 * Reduces sets to one point per session: the best work set.
 *
 * Warm-ups are excluded - including them would sink the curve on every session
 * where the ramp-up was logged.
 */
export function buildProgression(
  sets: SetEntry[],
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
): SessionPoint[] {
  const metric = progressionMetric(exercise);
  const bySession = new Map<Id, SessionPoint>();

  for (const set of sets) {
    if (set.kind !== 'work') continue;

    const value = set[metric];
    if (value === undefined) continue;

    const existing = bySession.get(set.sessionId);
    if (!existing) {
      bySession.set(set.sessionId, {
        sessionId: set.sessionId,
        performedAt: set.performedAt,
        value,
        setCount: 1,
        ...(metric === 'weightKg' && set.reps !== undefined ? { reps: set.reps } : {}),
      });
      continue;
    }

    existing.setCount += 1;

    // At equal load, the set with more reps is the better one.
    const isBetter =
      value > existing.value ||
      (value === existing.value &&
        metric === 'weightKg' &&
        (set.reps ?? 0) > (existing.reps ?? 0));

    if (isBetter) {
      existing.value = value;
      if (metric === 'weightKg') existing.reps = set.reps;
    }
  }

  return [...bySession.values()].sort((a, b) => a.performedAt - b.performedAt);
}

/** Gap between the last two sessions, `null` when there is nothing to compare. */
export function progressionDelta(points: SessionPoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[points.length - 2].value;
}

// ---------------------------------------------------------------------------
// Curve geometry
// ---------------------------------------------------------------------------

export interface ChartBox {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface PlottedPoint {
  x: number;
  y: number;
  point: SessionPoint;
}

export interface ChartGeometry {
  plotted: PlottedPoint[];
  /** The line path. */
  line: string;
  /** The area path under the line, closed on the baseline. */
  area: string;
  ticks: { y: number; value: number }[];
  /** Index of the highest point, to be labelled directly. */
  peakIndex: number;
}

/** Round ticks: at most `count`, on a readable step. */
function niceTicks(min: number, max: number, count = 3): number[] {
  if (max === min) return [max];

  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + 1e-9; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }
  return ticks;
}

/**
 * Projects the points into the SVG box.
 *
 * The x axis is **indexed by session**, not proportional to time: one tick is
 * one session. That is the expected reading for training tracking, and the axis
 * caption says so explicitly.
 */
export function buildChartGeometry(points: SessionPoint[], box: ChartBox): ChartGeometry {
  const { width, height, padding } = box;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);

  // A 10% margin so the line hugs neither ceiling nor floor. A single point,
  // or several identical ones, would give a zero span and divide by zero: it
  // gets an arbitrary span instead.
  const span = rawMax - rawMin || Math.max(rawMax * 0.2, 1);
  const min = rawMin - span * 0.1;
  const max = rawMax + span * 0.1;

  const toY = (value: number) => padding.top + plotHeight * (1 - (value - min) / (max - min));
  const toX = (index: number) =>
    padding.left + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1));

  const plotted = points.map((point, index) => ({
    x: toX(index),
    y: toY(point.value),
    point,
  }));

  const line = plotted
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');

  const base = padding.top + plotHeight;
  const area =
    plotted.length > 0
      ? `${line} L${plotted[plotted.length - 1].x.toFixed(1)},${base} L${plotted[0].x.toFixed(1)},${base} Z`
      : '';

  let peakIndex = 0;
  points.forEach((point, index) => {
    if (point.value > points[peakIndex].value) peakIndex = index;
  });

  return {
    plotted,
    line,
    area,
    ticks: niceTicks(rawMin, rawMax).map((value) => ({ y: toY(value), value })),
    peakIndex,
  };
}
