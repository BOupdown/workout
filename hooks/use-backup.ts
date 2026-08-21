'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { backupFileName, exportDatabase } from '@/lib/db/backup';
import type { Timestamp } from '@/lib/db/types';

/**
 * Device state, like the weight unit: when the data was last got off this
 * phone. It has no place in the exported file — a backup that claimed to have
 * been backed up would be nonsense — and none in another device's idea of
 * safety either.
 */
const STORAGE_KEY = 'workout.last-backup';

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function getSnapshot(): Timestamp | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Never on the server, and — deliberately — `null` rather than "recently".
 * Assuming safety is the one wrong answer here: an unknown state should read
 * as unprotected, not as fine.
 */
const noBackup = () => null;

/**
 * Below this, a rejection cannot be a person deciding.
 *
 * `share()` reports "the user dismissed the sheet" and "this browser will not
 * do it" with the same `AbortError`, which leaves no way to tell a deliberate
 * cancel from a refusal — except that a human takes a moment. A rejection
 * arriving in a few milliseconds never showed anybody anything.
 */
const CANCEL_FLOOR_MS = 250;

type ShareOutcome = 'sent' | 'cancelled' | 'unavailable';

/**
 * Hands the file to the share sheet, and says plainly what happened.
 *
 * Sharing is an enhancement, never the only road out. Anything other than a
 * genuine cancel reports `unavailable` so the caller falls back to a download:
 * the one outcome a backup feature must never produce is a tap that does
 * nothing at all.
 */
async function shareFile(json: string, name: string): Promise<ShareOutcome> {
  const file = new File([json], name, { type: 'application/json' });

  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) {
    return 'unavailable';
  }

  const startedAt = Date.now();
  try {
    await navigator.share({ files: [file], title: name });
    return 'sent';
  } catch (thrown) {
    const aborted = thrown instanceof DOMException && thrown.name === 'AbortError';
    // A cancel keeps the date where it is — claiming a backup that never left
    // the device would silence the reminder on a promise that is not true.
    if (aborted && Date.now() - startedAt >= CANCEL_FLOOR_MS) return 'cancelled';

    return 'unavailable';
  }
}

/** The road that always exists. */
function download(json: string, name: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export interface BackupExport {
  /** When the last export completed, `null` if there has never been one. */
  lastBackupAt: Timestamp | null;
  running: boolean;
  /** What just happened, for the screen to show. */
  message: string | null;
  error: string | null;
  /** Exports and, where the platform allows, hands it to the share sheet. */
  exportNow: () => Promise<void>;
  clearFeedback: () => void;
}

/**
 * Getting the data off the device.
 *
 * The share sheet is the point. A downloaded file lands in Downloads and then
 * has to be moved somewhere that survives the phone — which nobody does. Sharing
 * puts iCloud Drive, Google Drive and email one tap away, and the file leaves
 * the device for good.
 *
 * But it is an enhancement, not a requirement. A browser can advertise
 * `canShare` and still refuse the call — which used to leave the button doing
 * nothing at all, the worst possible outcome for the one feature standing
 * between someone and a lost history. Every failure short of a deliberate
 * cancel now falls back to the download.
 */
/**
 * Just when the last export happened.
 *
 * Split from the export itself so a screen that only wants to *mention* the
 * state does not drag in the machinery to change it — the home screen says
 * something is due, the settings are where it gets done.
 */
export function useLastBackupAt(): Timestamp | null {
  return useSyncExternalStore(subscribe, getSnapshot, noBackup);
}

export function useBackupExport(): BackupExport {
  const lastBackupAt = useLastBackupAt();

  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearFeedback = useCallback(() => {
    setMessage(null);
    setError(null);
  }, []);

  const exportNow = useCallback(async () => {
    setRunning(true);
    setError(null);
    setMessage(null);

    try {
      const backup = await exportDatabase();
      const name = backupFileName(backup.exportedAt);
      const json = JSON.stringify(backup);
      const count = backup.sessions.length;
      const plural = count > 1 ? 's' : '';

      const shared = await shareFile(json, name);
      if (shared === 'cancelled') return;

      if (shared === 'unavailable') download(json, name);
      setMessage(
        `Backup of ${count} session${plural} ${shared === 'sent' ? 'sent' : 'downloaded'}.`,
      );

      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
      for (const listener of listeners) listener();
    } catch {
      setError('The backup failed.');
    } finally {
      setRunning(false);
    }
  }, []);

  return { lastBackupAt, running, message, error, exportNow, clearFeedback };
}
