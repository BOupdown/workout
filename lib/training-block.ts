/**
 * Training blocks — what lifters call a cycle.
 *
 * A block is a stretch of weeks with one intent: strength, hypertrophy,
 * peaking, a deload, coming back from an injury. The label is free text,
 * deliberately: the app has no business encoding a methodology, and the same
 * feature then serves someone writing "prépa compét" as well as "force".
 *
 * A block has a **start and no end**. Nobody closes a block — you start the
 * next one and forget the last. With only a start, gaps and overlaps are not
 * rules to enforce but shapes that cannot be expressed, which is the same
 * reasoning that keeps supersets contiguous.
 *
 * What it is for is practical, not analytical: seeing that you are in week 3
 * tells you whether it is time to move on. That is why the week count matters
 * more than the colour.
 */

import { localMidnight } from './db/keys';
import type { Id, LocalDate, Timestamp } from './db/types';

export interface TrainingBlock {
  id: Id;
  /** What the user calls it. Free text — "Strength", "Deload", "Prépa". */
  label: string;
  /** The day it starts. It runs until the next block starts. */
  startsOn: LocalDate;
  createdAt: Timestamp;
}

/** Where a block stands on a given day. */
export interface BlockProgress {
  block: TrainingBlock;
  /** Days since it started, the first day being 0. */
  daysIn: number;
  /** Week it is in, counting from 1. */
  week: number;
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

/**
 * The block covering a day: the last one starting on or before it.
 *
 * `null` before the first block ever started — days that belong to no block
 * are ordinary days, not an error.
 */
export function blockOn(
  blocks: readonly TrainingBlock[],
  date: LocalDate,
): TrainingBlock | null {
  let found: TrainingBlock | null = null;

  for (const block of orderBlocks(blocks)) {
    if (block.startsOn > date) break;
    found = block;
  }

  return found;
}

/** How far into its block a day is, or `null` when it belongs to none. */
export function blockProgressOn(
  blocks: readonly TrainingBlock[],
  date: LocalDate,
): BlockProgress | null {
  const block = blockOn(blocks, date);
  if (!block) return null;

  const daysIn = daysBetween(block.startsOn, date);
  return { block, daysIn, week: Math.floor(daysIn / 7) + 1 };
}

/**
 * The block currently running, which is simply the one covering today.
 *
 * A block started in the future is not current — someone planning ahead has
 * not begun it yet, and saying "week 1" of something that has not started
 * would be a lie the counter tells every time it is read.
 */
export function currentBlock(
  blocks: readonly TrainingBlock[],
  today: LocalDate,
): BlockProgress | null {
  return blockProgressOn(blocks, today);
}
