import type { BodyWeight, LocalDate } from './db/types';
import { daysBetween } from './training-block';

export interface WeightPoint {
  date: LocalDate;
  /** Kilograms, as stored. Display conversion belongs to the screen. */
  value: number;
}

export interface WeightTrend {
  points: WeightPoint[];
  /** Where each point sits across the window, in `[0, 1]`. */
  fractions: number[];
  /** Last weight minus first, in kilograms. `null` below two points. */
  delta: number | null;
}

/**
 * The weigh-ins of a window, ready to plot.
 *
 * Positions are proportional to the date rather than to the reading's rank.
 * Weighing yourself on the 1st, 2nd, 3rd and then the 28th is not four evenly
 * spaced facts, and an indexed axis would draw a steady slope out of a gap —
 * exactly the misreading a weight chart exists to avoid.
 *
 * The span is the window, not the readings: a month with two weigh-ins a week
 * apart shows them a week apart, near where they fall on the calendar above,
 * instead of stretched to both edges.
 *
 * A single weigh-in comes back with a point and no delta. One reading is not a
 * trend, and the caller decides whether that is worth drawing.
 */
export function buildWeightTrend(
  entries: BodyWeight[],
  from: LocalDate,
  to: LocalDate,
): WeightTrend {
  const points = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({ date: entry.date, value: entry.weightKg }));

  // A window is at least one day wide; guarding the divide keeps a single-day
  // range from producing NaN positions.
  const span = Math.max(daysBetween(from, to), 1);

  const fractions = points.map((point) =>
    Math.min(Math.max(daysBetween(from, point.date) / span, 0), 1),
  );

  const delta =
    points.length >= 2 ? points[points.length - 1].value - points[0].value : null;

  return { points, fractions, delta };
}
