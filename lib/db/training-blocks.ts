/**
 * Reading and writing training blocks.
 *
 * The pure rules — which block covers a day, what week it is in — live in
 * `../training-block`, with no database in sight. This file only persists.
 */

import { db } from './db';
import { newId } from './keys';
import type { Id, LocalDate } from './types';
import type { TrainingBlock } from '../training-block';

/**
 * Starts a block on a day.
 *
 * A day can only be the start of one block, so starting a second on the same
 * date replaces the first rather than leaving two blocks claiming it. Without
 * that, "which block covers this day" would depend on insertion order — which
 * is exactly the kind of answer that changes for no visible reason.
 */
export async function startTrainingBlock(
  label: string,
  startsOn: LocalDate,
): Promise<TrainingBlock> {
  return db.transaction('rw', db.trainingBlocks, async () => {
    const clashing = await db.trainingBlocks.where('startsOn').equals(startsOn).toArray();
    await Promise.all(clashing.map((block) => db.trainingBlocks.delete(block.id)));

    const block: TrainingBlock = {
      id: newId(),
      label: label.trim(),
      startsOn,
      createdAt: Date.now(),
    };

    await db.trainingBlocks.add(block);
    return block;
  });
}

/** Removes a block. The one before it takes back the days it held. */
export async function deleteTrainingBlock(id: Id): Promise<void> {
  await db.trainingBlocks.delete(id);
}

/** Every block, oldest first. There are never many. */
export async function listTrainingBlocks(): Promise<TrainingBlock[]> {
  return db.trainingBlocks.orderBy('startsOn').toArray();
}
