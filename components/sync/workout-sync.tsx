'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { bindAccountDatabase, db, type WorkoutDB } from '@/lib/db/db';
import { accountDatabaseName, prepareAccountDatabase, TRAINING_TABLES } from '@/lib/db/account';
import { startWorkoutSync, type SyncStatus } from '@/lib/supabase/sync';
import { getSupabaseClient } from '@/lib/supabase/client';

/** Select the account's database before mounting any training screen. */
export function WorkoutSync({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [selected, setSelected] = useState<{ userId: string; database: WorkoutDB }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    if (db.name !== 'workout' && db.name !== accountDatabaseName(userId)) {
      // Reload discards unfinished UI handlers from the previous account.
      window.location.reload();
      return;
    }
    void prepareAccountDatabase(userId).then((database) => {
      if (!alive) { database.close(); return; }
      if (!bindAccountDatabase(database)) { database.close(); window.location.reload(); return; }
      setSelected({ userId, database });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [userId, attempt]);

  if (selected?.userId !== userId) return <SyncLoading
    message={failed ? 'Your local training could not be opened. Your existing data has been kept.' : 'Opening your training log…'}
    onRetry={failed ? () => { setFailed(false); setAttempt((value) => value + 1); } : undefined} />;
  return <AccountSync key={userId} userId={userId} database={selected.database}>{children}</AccountSync>;
}

export function AccountSync({ userId, database, children }: { userId: string; database: WorkoutDB; children: React.ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>('syncing');
  const [attempt, setAttempt] = useState(0);
  const state = useLiveQuery(async () => {
    // Outbox hooks write through native IndexedDB for atomicity. Observe the
    // domain tables too: those writes emit Dexie's invalidations.
    await Promise.all(TRAINING_TABLES.map((name) => database.table(name).count()));
    return {
      initialized: !!await database.localMetadata.get('initialized'),
      pending: await database.syncOperations.count(),
    };
  }, [database]);

  useEffect(() => {
    let alive = true;
    const stop = startWorkoutSync(userId, (next) => { if (alive) setStatus(next); }, database);
    return () => { alive = false; stop(); };
  }, [userId, database, attempt]);

  const retry = () => { setStatus('syncing'); setAttempt((value) => value + 1); };
  if (!state?.initialized) return <SyncLoading
    message={status === 'offline' ? 'Connect to load this account for the first time.'
      : status === 'error' ? 'Your training could not be downloaded. Your local data has been kept.'
      : 'Loading your account’s training…'}
    onRetry={status === 'error' || status === 'offline' ? retry : undefined} />;

  const message = status === 'offline' ? 'Offline · saved on this device'
    : status === 'error' ? 'Saved on this device · sync failed'
    : state.pending > 0 || status === 'pending' ? 'Saved on this device · sync pending'
    : status === 'syncing' ? 'Syncing your training…' : 'Training synced';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-center gap-3 border-b border-line bg-raised px-3 pt-[env(safe-area-inset-top)] text-xs text-muted">
        <p role="status" className="py-2">{message}</p>
        {status === 'error' ? <button type="button" onClick={retry} className="min-h-11 font-semibold text-ink underline">Retry sync</button> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function SyncLoading({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const [signOutFailed, setSignOutFailed] = useState(false);
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <p role="status" className="max-w-[34ch] text-sm text-muted">{message}</p>
      {onRetry ? <>
        <button type="button" onClick={onRetry} className="min-h-14 rounded-control bg-accent px-6 font-semibold text-accent-ink">Try again</button>
        <button type="button" className="min-h-11 text-sm text-muted underline" onClick={() => {
          void getSupabaseClient().auth.signOut().then(({ error }) => setSignOutFailed(!!error)).catch(() => setSignOutFailed(true));
        }}>Sign out</button>
        {signOutFailed ? <p role="alert">Could not sign out. Try again.</p> : null}
      </> : null}
    </main>
  );
}
