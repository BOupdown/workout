/** Primitives deriving the schema's keys and indexed fields. */

import type { LocalDate } from './types';

/**
 * Primary key: a v4 UUID, never an auto-increment — generatable outside a
 * transaction, and above all collision-free across a future export / import
 * between devices.
 *
 * `crypto.randomUUID()` only exists in a secure context. Testing the app from a
 * phone at `http://192.168.x.x:3000` is not one, hence the fallback:
 * `crypto.getRandomValues()` is available everywhere.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derives `Exercise.nameKey` from `Exercise.name`: lowercase, accents removed,
 * punctuation neutralised, whitespace collapsed.
 *
 * This is what makes "Bench press", "bench-press" and "Bench  Press" the *same*
 * exercise, and therefore the same progression history. Indexed as `&nameKey`
 * (unique) in the schema.
 */
export function toNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks separated out by NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Local dates
// ---------------------------------------------------------------------------

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Checks the `YYYY-MM-DD` format **and** that the day really exists. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;

  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);

  // Rejects dates that overflow (2026-02-30 would become March 2nd).
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** The local day of an instant, as the user perceives it. */
export function toLocalDate(timestamp: number): LocalDate {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of the given day. */
export function localMidnight(date: LocalDate): number {
  if (!isLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);

  const [, year, month, day] = LOCAL_DATE_PATTERN.exec(date)!.map(Number);
  return new Date(year, month - 1, day).getTime();
}
