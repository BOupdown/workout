/**
 * Conversions between numeric values and the text shown or typed.
 *
 * Input accepts both decimal separators. Someone on a French keyboard types
 * "102,5" out of habit even in an English interface, and rejecting that would
 * be pedantry. Output always uses the point.
 */

import type { Exercise, SetEntry } from './db/types';
import { toDisplayWeight, type WeightUnit } from './units';

/**
 * A plain decimal, optionally signed. Deliberately stricter than `Number()`,
 * which would accept "0x10" or "1e5" — neither means anything in a load field.
 */
const DECIMAL_PATTERN = /^-?(\d+([.]\d*)?|[.]\d+)$/;

/**
 * Reads an input field. Returns `null` when empty or unreadable: the caller
 * then omits the measure, and the database validation produces the precise
 * message ("Squat expects a load"). No rule is duplicated in the screen.
 */
export function parseNumberInput(value: string): number | null {
  const normalised = value.trim().replace(',', '.');
  if (normalised === '' || !DECIMAL_PATTERN.test(normalised)) return null;

  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Renders a number without trailing zeros. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function formatWeight(kilograms: number, unit: WeightUnit = 'kg'): string {
  return `${formatNumber(toDisplayWeight(kilograms, unit))} ${unit}`;
}

/** Duration as `m:ss`, or `h:mm:ss` past the hour. */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Time since a session started, in gym language: minutes below the hour, hours
 * above. Nobody cares about the seconds.
 */
export function formatElapsed(milliseconds: number): string {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} min`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * A set split in two, so the display can give the measured value the weight it
 * deserves and demote the qualifier.
 *
 * This is the single source of the rules for presenting a set: the shape
 * follows the exercise's nature, exactly as data entry does.
 */
export interface SetDescription {
  /** The quantity that progresses, brought forward. */
  primary: string;
  /** What qualifies it, kept back. */
  secondary?: string;
}

export function describeSet(
  set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
  unit: WeightUnit = 'kg',
): SetDescription {
  if (exercise.metric === 'time') {
    return { primary: set.durationSec !== undefined ? formatDuration(set.durationSec) : '?' };
  }

  if (set.reps === undefined) return { primary: '?' };

  // Bodyweight, or zero added/assisted load: showing "0 × 8" teaches nothing,
  // the reps carry all the information.
  if (exercise.loadType === 'bodyweight' || !set.weightKg) {
    return { primary: String(set.reps), secondary: 'reps' };
  }

  const sign = exercise.loadType === 'assisted' ? '-' : '';
  const weight = formatNumber(toDisplayWeight(set.weightKg, unit));
  return { primary: `${sign}${weight}`, secondary: `× ${set.reps}` };
}

/** One-line compact form, derived from the same rules. */
export function formatSetSummary(
  set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  exercise: Pick<Exercise, 'loadType' | 'metric'>,
  unit: WeightUnit = 'kg',
): string {
  const { primary, secondary } = describeSet(set, exercise, unit);
  return secondary ? `${primary} ${secondary}` : primary;
}
