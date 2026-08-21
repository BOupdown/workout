import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupReminderCard } from '../components/session/backup-reminder-card';
import { SettingsScreen } from '../components/settings/settings-screen';
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

describe('le rappel sur l’accueil', () => {
  it('reste muet tant que rien n’a été enregistré', async () => {
    render(<BackupReminderCard />);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByLabelText('Backup reminder')).toBeNull();
  });

  it('signale une base jamais sauvegardée', async () => {
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    expect(
      await screen.findByText(/only on this phone/, {}, { timeout: 5000 }),
    ).toBeDefined();
  });

  it('renvoie vers les réglages plutôt que d’agir lui-même', async () => {
    // Sauvegarder vit avec la restauration qu'elle reflète : l'accueil informe,
    // il n'exécute pas.
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    const line = await screen.findByLabelText('Backup reminder', {}, { timeout: 5000 });
    expect(line.textContent).toMatch(/Settings/);
    expect(screen.queryByRole('button', { name: /Back up/ })).toBeNull();
  });

  it('se tait une fois la sauvegarde faite', async () => {
    await recordSessions(FIRST_REMINDER_SESSIONS);
    window.localStorage.setItem(KEY, String(Date.now()));

    render(<BackupReminderCard />);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByLabelText('Backup reminder')).toBeNull();
  });
});

describe('l’export, dans les réglages', () => {
  const exportButton = () =>
    screen.findByRole('button', { name: /Export my data/ }, { timeout: 5000 });

  it('passe par la feuille de partage quand elle existe', async () => {
    // Un fichier téléchargé finit dans Téléchargements et n'en sort jamais.
    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => share.mock.calls.length).toBe(1);
    const shared = share.mock.calls[0][0] as { files: File[] };
    expect(shared.files[0].name).toMatch(/^workout-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('enregistre la date une fois le partage abouti', async () => {
    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('n’enregistre rien si le partage est annulé', async () => {
    // Le piège : `share` rejette avec AbortError quand on ferme la feuille.
    // Compter ça comme une sauvegarde ferait taire le rappel en promettant une
    // sécurité qui n'existe pas.
    share.mockRejectedValue(new DOMException('cancelled', 'AbortError'));

    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('retombe sur le téléchargement là où le partage n’existe pas', async () => {
    canShare.mockReturnValue(false);
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => clicked.mock.calls.length).toBe(1);
    expect(share).not.toHaveBeenCalled();
    clicked.mockRestore();
  });

  it('affiche « never » tant que rien n’a été exporté, puis la date', async () => {
    // « never » est la réponse qui compte : une ligne vide se lirait comme une
    // assurance.
    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    expect(await screen.findByText(/Last backup:\s*never/, {}, { timeout: 5000 })).toBeDefined();

    await user.click(await exportButton());

    await expect
      .poll(() => screen.queryByText(/Last backup:\s*never/) === null, { timeout: 5000 })
      .toBe(true);
  });
});
