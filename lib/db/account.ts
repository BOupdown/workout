import { WorkoutDB } from './db';
import { withoutSyncOutbox } from './sync-mute';

export const TRAINING_TABLES = [
  'exercises', 'sessions', 'sessionExercises', 'sets', 'bodyweights',
  'trainingBlocks', 'retiredExercises',
] as const;

export const accountDatabaseName = (userId: string) => `workout.account.${encodeURIComponent(userId)}`;

/** Copy the legacy database once, for its owner only. Keep the original intact
 * as a recovery copy. Ownership and copy completion live in IndexedDB, so two
 * tabs cannot claim the same legacy history for different accounts. */
export async function prepareAccountDatabase(userId: string): Promise<WorkoutDB> {
  const target = new WorkoutDB(accountDatabaseName(userId));
  const legacy = new WorkoutDB();
  try {
    await target.open();
    if (await target.localMetadata.get('imported')) return target;
    await legacy.open();
    const owner = await legacy.transaction('rw', legacy.localMetadata, async () => {
      const known = await legacy.localMetadata.get('owner');
      if (known) return known.value;
      const value = localStorage.getItem('workout.sync.account') ?? userId;
      await legacy.localMetadata.put({ key: 'owner', value });
      return value;
    });

    const names = [...TRAINING_TABLES, 'syncOperations'] as const;
    const rows = owner === userId
      ? await legacy.transaction('r', names, () => Promise.all(names.map((name) => legacy.table(name).toArray())))
      : null;

    await target.transaction('rw', [...names, 'localMetadata'], async () => {
      if (await target.localMetadata.get('imported')) return;
      if (rows) {
        await withoutSyncOutbox(async () => {
          for (const [index, name] of names.entries()) {
            await target.table(name).clear();
            await target.table(name).bulkPut(rows[index]);
          }
        });
        if (localStorage.getItem(`workout.sync.initialized.${userId}`) === 'true') {
          await target.localMetadata.put({ key: 'initialized', value: 'true' });
        }
      }
      await target.localMetadata.put({ key: 'owner', value: userId });
      await target.localMetadata.put({ key: 'imported', value: 'true' });
    });
    return target;
  } catch (error) {
    target.close();
    throw error;
  } finally {
    legacy.close();
  }
}
