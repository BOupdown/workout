import { describe, expect, it } from 'vitest';
import {
  backupReminder,
  DAY_MS,
  FIRST_REMINDER_SESSIONS,
  REMINDER_DAYS,
  REMINDER_SESSIONS,
} from '../lib/backup-reminder';

const NOW = 1_800_000_000_000;
const daysAgo = (days: number) => NOW - days * DAY_MS;

describe('backupReminder', () => {
  it('says nothing when nothing has been recorded since', () => {
    // A month away from the gym puts no data at risk: nagging then would only
    // teach the user to ignore the banner.
    expect(
      backupReminder({ lastBackupAt: daysAgo(90), sessionsSince: 0, now: NOW }),
    ).toBeNull();
  });

  it('says nothing either when nothing was ever exported and nothing done', () => {
    expect(backupReminder({ lastBackupAt: null, sessionsSince: 0, now: NOW })).toBeNull();
  });

  it('lets the very first session pass without a word', () => {
    expect(
      backupReminder({
        lastBackupAt: null,
        sessionsSince: FIRST_REMINDER_SESSIONS - 1,
        now: NOW,
      }),
    ).toBeNull();
  });

  it('speaks up for a database that was never backed up', () => {
    const reminder = backupReminder({
      lastBackupAt: null,
      sessionsSince: FIRST_REMINDER_SESSIONS,
      now: NOW,
    });

    expect(reminder).not.toBeNull();
    expect(reminder?.never).toBe(true);
    expect(reminder?.daysSince).toBeNull();
  });

  it('goes quiet right after an export', () => {
    expect(
      backupReminder({ lastBackupAt: daysAgo(1), sessionsSince: 1, now: NOW }),
    ).toBeNull();
  });

  it('comes back after enough sessions', () => {
    const reminder = backupReminder({
      lastBackupAt: daysAgo(2),
      sessionsSince: REMINDER_SESSIONS,
      now: NOW,
    });

    expect(reminder?.never).toBe(false);
    expect(reminder?.sessionsSince).toBe(REMINDER_SESSIONS);
    expect(reminder?.daysSince).toBe(2);
  });

  it('comes back after enough time too, on a single session', () => {
    const reminder = backupReminder({
      lastBackupAt: daysAgo(REMINDER_DAYS),
      sessionsSince: 1,
      now: NOW,
    });

    expect(reminder).not.toBeNull();
    expect(reminder?.daysSince).toBe(REMINDER_DAYS);
  });

  it('counts whole days, never rounding one up', () => {
    const reminder = backupReminder({
      lastBackupAt: NOW - (REMINDER_DAYS * DAY_MS + DAY_MS / 2),
      sessionsSince: 1,
      now: NOW,
    });

    expect(reminder?.daysSince).toBe(REMINDER_DAYS);
  });

  it('never reports a negative number of days', () => {
    // Clock set back: zero reads better than "-3 days ago".
    const reminder = backupReminder({
      lastBackupAt: NOW + 5 * DAY_MS,
      sessionsSince: REMINDER_SESSIONS,
      now: NOW,
    });

    expect(reminder?.daysSince).toBe(0);
  });
});
