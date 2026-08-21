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
 * A set as a short ordered reading, each piece carrying its own emphasis.
 *
 * Order and prominence are two separate questions, and keeping them in one
 * `primary`/`secondary` pair forced the same answer to both: whichever number
 * came first was also the big one. Reps read first, matching the order they
 * are typed in — but on a loaded lift the load is still the number you scan a
 * column of history for, so it keeps the emphasis from second place.
 *
 * This is the single source of the rules for presenting a set: the shape
 * follows the exercise's nature, exactly as data entry does.
 */
export interface SetPart {
  text: string;
  /** Given the visual weight: the quantity that progresses. */
  strong: boolean;
}

export type SetDescription = SetPart[];

export function describeSet(
  set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  exercise: Pick<Exercise, 'loadType' | 'metric' | 'perSide'>,
  unit: WeightUnit = 'kg',
): SetDescription {
  /*
   * "Ten reps" means ten on a bench and twenty on a one-arm row, and the model
   * has carried `perSide` from the first schema to settle exactly that. It was
   * never shown anywhere, so the ambiguity it exists to remove survived intact:
   * a unilateral exercise read identically to any other.
   *
   * Said here rather than in each screen, because every place a set is
   * rendered goes through this function — the session, the history, the
   * progression table — and a rule stated four times is a rule that will end
   * up stated four different ways.
   */
  const perSide = exercise.perSide ? '/side' : '';

  // A held position is just as ambiguous as a counted one: 45 seconds of side
  // plank is 90 seconds of work, and reads like a front plank without this.
  if (exercise.metric === 'time') {
    if (set.durationSec === undefined) return [{ text: '?', strong: true }];

    const held: SetDescription = [{ text: formatDuration(set.durationSec), strong: true }];
    if (exercise.perSide) held.push({ text: 'per side', strong: false });
    return held;
  }

  if (set.reps === undefined) return [{ text: '?', strong: true }];

  // Bodyweight, or zero added/assisted load: showing "8 × 0" teaches nothing,
  // the reps carry all the information — and are what progresses, so they are
  // both first and emphasised here.
  if (exercise.loadType === 'bodyweight' || !set.weightKg) {
    return [
      { text: String(set.reps), strong: true },
      { text: `reps${perSide}`, strong: false },
    ];
  }

  const sign = exercise.loadType === 'assisted' ? '-' : '';
  const weight = formatNumber(toDisplayWeight(set.weightKg, unit));

  // "/side" trails the whole reading rather than sitting inside it: "5 × 22/side"
  // is how the set is said out loud, and breaking the two numbers apart to
  // qualify only the first one reads worse than the ambiguity it removes. On a
  // dumbbell the load is per side too; on a barbell split squat it is not, and
  // the exercise's own "· per side" label in the picker carries that.
  return [
    { text: `${set.reps} ×`, strong: false },
    { text: `${sign}${weight}${perSide}`, strong: true },
  ];
}

/** One-line compact form, derived from the same rules. */
export function formatSetSummary(
  set: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  exercise: Pick<Exercise, 'loadType' | 'metric' | 'perSide'>,
  unit: WeightUnit = 'kg',
): string {
  return describeSet(set, exercise, unit)
    .map((part) => part.text)
    .join(' ');
}
