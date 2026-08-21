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
 * the device for good. Where `share` is unavailable (desktop browsers, older
 * engines) the download is still there.
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

      const file = new File([json], name, { type: 'application/json' });

      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
        } catch (thrown) {
          // Cancelling the share sheet is not a failure, but it is also not a
          // backup: the date must not move, or the app would claim a safety
          // that does not exist.
          if (thrown instanceof DOMException && thrown.name === 'AbortError') return;
          throw thrown;
        }

        setMessage(`Backup of ${count} session${plural} sent.`);
      } else {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);

        setMessage(`Backup of ${count} session${plural} downloaded.`);
      }

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
