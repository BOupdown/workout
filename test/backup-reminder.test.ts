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
  it('ne dit rien quand rien n’a été enregistré depuis', () => {
    // Un mois sans salle ne met aucune donnée en danger : alerter là
    // n'apprendrait qu'à ignorer le bandeau.
    expect(
      backupReminder({ lastBackupAt: daysAgo(90), sessionsSince: 0, now: NOW }),
    ).toBeNull();
  });

  it('ne dit rien non plus si rien n’a jamais été exporté mais rien fait', () => {
    expect(backupReminder({ lastBackupAt: null, sessionsSince: 0, now: NOW })).toBeNull();
  });

  it('laisse passer la toute première séance sans rien dire', () => {
    expect(
      backupReminder({
        lastBackupAt: null,
        sessionsSince: FIRST_REMINDER_SESSIONS - 1,
        now: NOW,
      }),
    ).toBeNull();
  });

  it('signale une base jamais sauvegardée', () => {
    const reminder = backupReminder({
      lastBackupAt: null,
      sessionsSince: FIRST_REMINDER_SESSIONS,
      now: NOW,
    });

    expect(reminder).not.toBeNull();
    expect(reminder?.never).toBe(true);
    expect(reminder?.daysSince).toBeNull();
  });

  it('se tait juste après un export', () => {
    expect(
      backupReminder({ lastBackupAt: daysAgo(1), sessionsSince: 1, now: NOW }),
    ).toBeNull();
  });

  it('revient après assez de séances', () => {
    const reminder = backupReminder({
      lastBackupAt: daysAgo(2),
      sessionsSince: REMINDER_SESSIONS,
      now: NOW,
    });

    expect(reminder?.never).toBe(false);
    expect(reminder?.sessionsSince).toBe(REMINDER_SESSIONS);
    expect(reminder?.daysSince).toBe(2);
  });

  it('revient aussi après assez de temps, même avec une seule séance', () => {
    const reminder = backupReminder({
      lastBackupAt: daysAgo(REMINDER_DAYS),
      sessionsSince: 1,
      now: NOW,
    });

    expect(reminder).not.toBeNull();
    expect(reminder?.daysSince).toBe(REMINDER_DAYS);
  });

  it('compte les jours en entiers, sans arrondir vers le haut', () => {
    const reminder = backupReminder({
      lastBackupAt: NOW - (REMINDER_DAYS * DAY_MS + DAY_MS / 2),
      sessionsSince: 1,
      now: NOW,
    });

    expect(reminder?.daysSince).toBe(REMINDER_DAYS);
  });

  it('ne rend jamais un nombre de jours négatif', () => {
    // Horloge reculée : mieux vaut zéro qu'un « il y a -3 jours ».
    const reminder = backupReminder({
      lastBackupAt: NOW + 5 * DAY_MS,
      sessionsSince: REMINDER_SESSIONS,
      now: NOW,
    });

    expect(reminder?.daysSince).toBe(0);
  });
});
