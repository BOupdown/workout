'use client';

import { WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { db } from '@/lib/db/db';

type Status = 'checking' | 'ready' | 'unavailable';

/**
 * Guard on IndexedDB availability.
 *
 * Without it, a browser where storage is blocked - private browsing on some
 * engines, a strict privacy setting - gave a broken screen with no explanation.
 * The whole app rests on this database: if it will not open, say so rather than
 * leaving the user staring at an endless spinner.
 *
 * Children render until the verdict lands: every screen already has its own
 * loading state, and one more guard screen would only add a flicker.
 */
export function StorageGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    db.open().then(
      () => !cancelled && setStatus('ready'),
      () => !cancelled && setStatus('unavailable'),
    );

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'unavailable') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <WarningCircle size={32} weight="duotone" className="text-muted" />
        <h1 className="mt-4 text-lg font-semibold text-ink">Storage unavailable</h1>
        <p className="mt-2 max-w-[32ch] text-sm text-muted">
          This app stores your sessions on your device, and your browser will not allow it. In
          private browsing, try a normal window; otherwise check that site data is allowed.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
