/**
 * When to bring up backing up.
 *
 * Everything lives on the device, so a lost phone is a lost history. The app
 * cannot prevent that without a server it deliberately does not have — but it
 * can make sure the loss is never a *surprise*. A silent risk the user was
 * never told about is the part that is unforgivable; a risk they declined to
 * act on is their own.
 *
 * The rule below is tuned to nag rarely enough to stay credible. A reminder
 * shown after every session is a reminder nobody reads.
 */

import type { Timestamp } from './db/types';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Sessions worth a first mention when nothing has ever been exported. */
export const FIRST_REMINDER_SESSIONS = 2;
/** Sessions since the last export that warrant bringing it up again. */
export const REMINDER_SESSIONS = 4;
/** Or, failing that, a plain stretch of time with at least one session in it. */
export const REMINDER_DAYS = 14;

export interface BackupState {
  /** When the last export completed, or `null` if there has never been one. */
  lastBackupAt: Timestamp | null;
  /** Sessions recorded since then. */
  sessionsSince: number;
  now: Timestamp;
}

export interface BackupReminder {
  /** `true` when nothing has ever been exported: the wording differs. */
  never: boolean;
  sessionsSince: number;
  /** Whole days since the last export. `null` when there has never been one. */
  daysSince: number | null;
}

/**
 * The reminder to show, or `null` when there is nothing to say.
 *
 * Nothing to say means nothing has been recorded since the last export. Time
 * alone never triggers it: a month away from the gym puts no data at risk, and
 * nagging then would only teach the user to ignore the banner for the month
 * when it finally matters.
 */
export function backupReminder(state: BackupState): BackupReminder | null {
  const { lastBackupAt, sessionsSince, now } = state;

  if (sessionsSince <= 0) return null;

  if (lastBackupAt === null) {
    if (sessionsSince < FIRST_REMINDER_SESSIONS) return null;
    return { never: true, sessionsSince, daysSince: null };
  }

  const daysSince = Math.max(0, Math.floor((now - lastBackupAt) / DAY_MS));
  if (sessionsSince < REMINDER_SESSIONS && daysSince < REMINDER_DAYS) return null;

  return { never: false, sessionsSince, daysSince };
}
