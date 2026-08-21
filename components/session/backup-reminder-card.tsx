'use client';

import { FloppyDisk } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { countSessionsSince } from '@/lib/db/queries';
import { backupReminder } from '@/lib/backup-reminder';
import { useBackupExport } from '@/hooks/use-backup';

/**
 * The one honest answer to storing everything on one device.
 *
 * Placed on the screen you land on after finishing a session — the phone is
 * still in your hand and something has just been created — rather than in the
 * settings, where the export sat unused for as long as it existed.
 *
 * It says how much is at stake in sessions, not in reassuring words: "9
 * sessions since your last backup" is a number someone can weigh. It is not a
 * dialog and blocks nothing; ignoring it is a decision the user is entitled to
 * make, and the only thing that would be unforgivable is not telling them.
 */
export function BackupReminderCard() {
  const { lastBackupAt, running, message, error, exportNow } = useBackupExport();

  // Computed inside the query, not during render: the clock is not a pure
  // input, and reading it while rendering is the same class of mistake as the
  // hydration mismatch this app already paid for once.
  const reminder = useLiveQuery(async () => {
    const sessionsSince = await countSessionsSince(lastBackupAt);
    return backupReminder({ lastBackupAt, sessionsSince, now: Date.now() });
  }, [lastBackupAt]);

  if (reminder === undefined) return null;
  if (reminder === null && message === null && error === null) return null;

  return (
    <section
      aria-label="Backup reminder"
      className="mt-3 rounded-panel bg-raised px-4 py-3.5"
    >
      <div className="flex items-start gap-2.5">
        <FloppyDisk size={18} weight="bold" className="mt-0.5 shrink-0 text-ink" />
        <div className="min-w-0 flex-1">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : message ? (
            <p className="text-sm text-ink">{message}</p>
          ) : reminder ? (
            <>
              <p className="text-sm font-medium text-ink">
                {reminder.never
                  ? 'Your training is only on this phone'
                  : `${reminder.sessionsSince} session${
                      reminder.sessionsSince > 1 ? 's' : ''
                    } since your last backup`}
              </p>
              <p className="mt-1 text-sm text-muted">
                {reminder.never
                  ? 'Nothing has ever been backed up. Lose the phone and the history goes with it.'
                  : `Last backup ${
                      reminder.daysSince === 0 ? 'today' : `${reminder.daysSince} days ago`
                    }.`}
              </p>
            </>
          ) : null}
        </div>
      </div>

      {reminder && message === null ? (
        <button
          type="button"
          onClick={exportNow}
          disabled={running}
          className="mt-3 h-14 w-full rounded-control bg-ink text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {running ? 'Preparing…' : 'Back up now'}
        </button>
      ) : null}
    </section>
  );
}
