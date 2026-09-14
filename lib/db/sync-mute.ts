import Dexie, { type Transaction } from 'dexie';

/** Only the cloud import's transaction is muted, never concurrent user edits. */
const muted = new WeakSet<IDBTransaction>();

export function syncWritesAreMuted(transaction: Transaction): boolean {
  return muted.has(transaction.idbtrans);
}

export async function withoutSyncOutbox<T>(work: () => Promise<T>): Promise<T> {
  const transaction = Dexie.currentTransaction?.idbtrans;
  if (!transaction) throw new Error('Cloud imports require a database transaction.');
  const alreadyMuted = muted.has(transaction);
  muted.add(transaction);
  try {
    return await work();
  } finally {
    if (!alreadyMuted) muted.delete(transaction);
  }
}
