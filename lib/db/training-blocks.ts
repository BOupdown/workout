/**
 * Reading and writing training blocks.
 *
 * The pure rules — which block covers a day, what week it is in, whether two
 * spans collide — live in `../training-block`, with no database in sight. This
 * file persists them, and enforces the one invariant that needs to read the
 * others: no two blocks may cover the same day.
 */

import { db } from './db';
import { newId } from './keys';
import type { Id, LocalDate } from './types';
import { overlaps, type TrainingBlock } from '../training-block';

/**
 * A block would have sat on top of one that already exists.
 *
 * Carries the offender so the screen can name it: "Strength already covers
 * those days" is actionable, "invalid dates" is not.
 */
export class BlockOverlapError extends Error {
  readonly conflicting: TrainingBlock;

  constructor(conflicting: TrainingBlock) {
    super(`“${conflicting.label}” already covers those days.`);
    this.name = 'BlockOverlapError';
    this.conflicting = conflicting;
  }
}

/**
 * Creates a block over a span of days, both ends included.
 *
 * @throws {BlockOverlapError} when the span touches an existing block.
 */
export async function createTrainingBlock(
  label: string,
  startsOn: LocalDate,
  endsOn: LocalDate,
): Promise<TrainingBlock> {
  return db.transaction('rw', db.trainingBlocks, async () => {
    // Read and write share the transaction, so nothing can slip in between the
    // check and the insert.
    const existing = await db.trainingBlocks.toArray();
    const clash = overlaps(existing, { startsOn, endsOn });
    if (clash) throw new BlockOverlapError(clash);

    const block: TrainingBlock = {
      id: newId(),
      label: label.trim(),
      startsOn,
      endsOn,
      createdAt: Date.now(),
    };

    await db.trainingBlocks.add(block);
    return block;
  });
}

/** Removes a block. Its days become ordinary days again. */
export async function deleteTrainingBlock(id: Id): Promise<void> {
  await db.trainingBlocks.delete(id);
}

/** Every block, oldest first. There are never many. */
export async function listTrainingBlocks(): Promise<TrainingBlock[]> {
  return db.trainingBlocks.orderBy('startsOn').toArray();
}
