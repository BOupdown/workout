/**
 * Training blocks — what lifters call a cycle.
 *
 * A block is a stretch of weeks with one intent: strength, hypertrophy,
 * peaking, a deload, coming back from an injury. The label is free text,
 * deliberately: the app has no business encoding a methodology, and the same
 * feature then serves someone writing "prépa compét" as well as "force".
 *
 * A block has a **start and an end**, both chosen up front. That is what lets
 * the counter say "week 2 of 4" rather than just "week 2" — and the whole
 * point of the feature is knowing when to move on, which a plan with a stated
 * length answers outright.
 *
 * The price is that two shapes become expressible and have to be ruled out
 * rather than made impossible: a gap between blocks, and an overlap. Gaps are
 * fine — days belonging to no block are ordinary days. Overlaps are not: you
 * are not in two cycles at once, so they are refused when a block is created.
 */

import { localMidnight } from './db/keys';
import type { Id, LocalDate, Timestamp } from './db/types';

export interface TrainingBlock {
  id: Id;
  /** What the user calls it. Free text — "Strength", "Deload", "Prépa". */
  label: string;
  startsOn: LocalDate;
  /** Inclusive: the last day of the block, not the first day after it. */
  endsOn: LocalDate;
  createdAt: Timestamp;
}

/** Where a block stands on a given day. */
export interface BlockProgress {
  block: TrainingBlock;
  /** Days since it started, the first day being 0. */
  daysIn: number;
  /** Week it is in, counting from 1. */
  week: number;
  /** How many weeks it runs in total, rounded up. */
  totalWeeks: number;
  /** Days remaining, the last day counting as 0. */
  daysLeft: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between two local dates.
 *
 * Rounded rather than floored: a daylight-saving change makes one of those
 * days 23 or 25 hours long, and a plain division would report six days
 * between dates a week apart, twice a year, in one direction only.
 */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((localMidnight(to) - localMidnight(from)) / DAY_MS);
}

/** Blocks in the order they run. */
export function orderBlocks(blocks: readonly TrainingBlock[]): TrainingBlock[] {
  return [...blocks].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

/** Whether a day falls inside a block, both ends included. */
export function covers(block: TrainingBlock, date: LocalDate): boolean {
  return block.startsOn <= date && date <= block.endsOn;
}

/**
 * Whether a proposed span would sit on top of an existing block.
 *
 * Two spans overlap unless one ends before the other starts. Written that way
 * round because it is the only formulation with no edge case: touching spans,
 * where one ends the day the next begins, correctly count as overlapping.
 */
export function overlaps(
  blocks: readonly TrainingBlock[],
  span: { startsOn: LocalDate; endsOn: LocalDate },
  ignoreId?: Id,
): TrainingBlock | null {
  for (const block of orderBlocks(blocks)) {
    if (block.id === ignoreId) continue;
    if (block.endsOn < span.startsOn || span.endsOn < block.startsOn) continue;
    return block;
  }

  return null;
}

/**
 * The block covering a day, or `null`.
 *
 * `null` covers both "before any block" and "in a gap between two", which are
 * the same thing to a reader: an ordinary day, not an error.
 */
export function blockOn(
  blocks: readonly TrainingBlock[],
  date: LocalDate,
): TrainingBlock | null {
  return orderBlocks(blocks).find((block) => covers(block, date)) ?? null;
}

/**
 * The tint classes, in the order blocks take them.
 *
 * Written out in full rather than assembled from a template because Tailwind
 * reads the source for class names: a string built at runtime would never make
 * it into the stylesheet, and every cycle would come out colourless.
 */
export const CYCLE_TINTS = [
  'bg-cycle-1',
  'bg-cycle-2',
  'bg-cycle-3',
  'bg-cycle-4',
  'bg-cycle-5',
  'bg-cycle-6',
] as const;

/**
 * A tint for every block, in the order they run.
 *
 * Chronological rather than by identifier, so two blocks side by side never
 * share a colour — which is the whole job. Past six the palette repeats, and by
 * then the two blocks wearing one colour are half a year apart.
 */
export function tintByBlock(blocks: readonly TrainingBlock[]): Map<Id, string> {
  return new Map(
    orderBlocks(blocks).map((block, index) => [
      block.id,
      CYCLE_TINTS[index % CYCLE_TINTS.length],
    ]),
  );
}

/** How far into its block a day is, or `null` when it belongs to none. */
export function blockProgressOn(
  blocks: readonly TrainingBlock[],
  date: LocalDate,
): BlockProgress | null {
  const block = blockOn(blocks, date);
  if (!block) return null;

  const daysIn = daysBetween(block.startsOn, date);
  const span = daysBetween(block.startsOn, block.endsOn);

  return {
    block,
    daysIn,
    week: Math.floor(daysIn / 7) + 1,
    // Rounded up: a block of ten days is two weeks, the second being short.
    totalWeeks: Math.floor(span / 7) + 1,
    daysLeft: span - daysIn,
  };
}

/**
 * The block running today.
 *
 * A block planned for later is not current — saying "week 1" of something that
 * has not started would be a lie repeated every time the counter is read.
 */
export function currentBlock(
  blocks: readonly TrainingBlock[],
  today: LocalDate,
): BlockProgress | null {
  return blockProgressOn(blocks, today);
}
