/** True only while a trusted cloud snapshot is being applied to IndexedDB. */
let muted = false;

export function syncWritesAreMuted(): boolean {
  return muted;
}

export async function withoutSyncOutbox<T>(work: () => Promise<T>): Promise<T> {
  muted = true;
  try {
    return await work();
  } finally {
    muted = false;
  }
}
