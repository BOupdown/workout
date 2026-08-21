'use client';

import { FloppyDisk } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { countSessionsSince } from '@/lib/db/queries';
import { backupReminder } from '@/lib/backup-reminder';
import { useLastBackupAt } from '@/hooks/use-backup';

/**
 * A line, on the screen you land on after finishing a session, saying the data
 * is only here.
 *
 * Deliberately just a line. Backing up belongs in the settings with the restore
 * it mirrors, and a panel with its own action button on the home screen would
 * put a rarely-used gesture in front of the one people actually came for. What
 * cannot stay in the settings is the *knowing*: an export nobody remembers is
 * an export nobody makes, and the loss it guards against is silent.
 *
 * So this says how much is at stake — in sessions, a number someone can
 * weigh — and stops there. Settings is one tap away in the tab bar.
 */
export function BackupReminderCard() {
  const lastBackupAt = useLastBackupAt();

  // Computed inside the query, not during render: the clock is not a pure
  // input, and reading it while rendering is the same class of mistake as the
  // hydration mismatch this app already paid for once.
  const reminder = useLiveQuery(async () => {
    const sessionsSince = await countSessionsSince(lastBackupAt);
    return backupReminder({ lastBackupAt, sessionsSince, now: Date.now() });
  }, [lastBackupAt]);

  if (!reminder) return null;

  return (
    <p
      aria-label="Backup reminder"
      className="mt-3 flex items-start gap-2 px-1 text-xs text-muted"
    >
      <FloppyDisk size={14} weight="bold" className="mt-0.5 shrink-0" />
      <span>
        {reminder.never
          ? 'Your training is only on this phone. Back it up from Settings.'
          : `${reminder.sessionsSince} session${
              reminder.sessionsSince > 1 ? 's' : ''
            } since your last backup. Settings has the export.`}
      </span>
    </p>
  );
}
