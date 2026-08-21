import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupReminderCard } from '../components/session/backup-reminder-card';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import { FIRST_REMINDER_SESSIONS } from '../lib/backup-reminder';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

const KEY = 'workout.last-backup';

let squat: Exercise;
let share: ReturnType<typeof vi.fn>;
let canShare: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
  window.localStorage.clear();

  share = vi.fn().mockResolvedValue(undefined);
  canShare = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
});

async function recordSessions(count: number) {
  for (let i = 0; i < count; i += 1) {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await endSession(session.id);
  }
}

describe('le rappel de sauvegarde', () => {
  it('reste muet tant que rien n’a été enregistré', async () => {
    render(<BackupReminderCard />);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByRole('region', { name: 'Backup reminder' })).toBeNull();
  });

  it('se manifeste quand rien n’a jamais été sauvegardé', async () => {
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    expect(
      await screen.findByText(/only on this phone/, {}, { timeout: 5000 }),
    ).toBeDefined();
  });

  it('passe par la feuille de partage quand elle existe', async () => {
    // Un fichier téléchargé finit dans Téléchargements et n'en sort jamais.
    const user = userEvent.setup();
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    await user.click(await screen.findByRole('button', { name: /Back up now/ }, { timeout: 5000 }));

    await expect.poll(() => share.mock.calls.length).toBe(1);
    const shared = share.mock.calls[0][0] as { files: File[] };
    expect(shared.files[0].name).toMatch(/^workout-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('enregistre la date une fois le partage abouti', async () => {
    const user = userEvent.setup();
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    await user.click(await screen.findByRole('button', { name: /Back up now/ }, { timeout: 5000 }));

    await expect.poll(() => window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('n’enregistre rien si le partage est annulé', async () => {
    // Le piège : `share` rejette avec AbortError quand on ferme la feuille.
    // Compter ça comme une sauvegarde ferait taire le rappel en promettant une
    // sécurité qui n'existe pas.
    share.mockRejectedValue(new DOMException('cancelled', 'AbortError'));

    const user = userEvent.setup();
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    await user.click(await screen.findByRole('button', { name: /Back up now/ }, { timeout: 5000 }));

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByRole('button', { name: /Back up now/ })).toBeDefined();
  });

  it('se tait une fois la sauvegarde faite', async () => {
    const user = userEvent.setup();
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    await user.click(await screen.findByRole('button', { name: /Back up now/ }, { timeout: 5000 }));

    expect(await screen.findByText(/sent\./, {}, { timeout: 5000 })).toBeDefined();
    expect(screen.queryByText(/only on this phone/)).toBeNull();
  });

  it('retombe sur le téléchargement là où le partage n’existe pas', async () => {
    canShare.mockReturnValue(false);
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    await user.click(await screen.findByRole('button', { name: /Back up now/ }, { timeout: 5000 }));

    await expect.poll(() => clicked.mock.calls.length).toBe(1);
    expect(share).not.toHaveBeenCalled();
    clicked.mockRestore();
  });
});
