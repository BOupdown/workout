/**
 * The bodyweight timeline.
 *
 * One weight per day, keyed by the day itself, so recording is an upsert and
 * there is never a second value competing for the same date. Reading a
 * session's weight means reading the weight of its day: the session stores no
 * copy of its own, and so cannot disagree with the calendar.
 */

import { db } from './db';
import type { BodyWeight, LocalDate, Timestamp } from './types';

/**
 * Records the weight for a day, or clears it when passed `undefined`.
 *
 * Deliberately an upsert rather than an insert: weighing yourself twice in a
 * morning is a correction, not a second fact.
 */
export async function setBodyWeight(
  date: LocalDate,
  weightKg: number | undefined,
  recordedAt: Timestamp = Date.now(),
): Promise<BodyWeight | undefined> {
  return db.transaction('rw', db.bodyweights, async () => {
    if (weightKg === undefined) {
      await db.bodyweights.delete(date);
      return undefined;
    }

    const entry: BodyWeight = { date, weightKg, recordedAt };
    await db.bodyweights.put(entry);
    return entry;
  });
}

/** The weight recorded for a day, if any. */
export async function getBodyWeight(date: LocalDate): Promise<BodyWeight | undefined> {
  return db.bodyweights.get(date);
}

/**
 * Every weight between two days, inclusive, oldest first.
 *
 * The primary key is the date, so this is a range scan over the key itself —
 * no index to maintain and no row read outside the window.
 */
export async function listBodyWeights(
  from: LocalDate,
  to: LocalDate,
): Promise<BodyWeight[]> {
  return db.bodyweights.where('date').between(from, to, true, true).toArray();
}
