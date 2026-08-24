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

describe('the reminder on the home screen', () => {
  it('stays silent while nothing has been recorded', async () => {
    render(<BackupReminderCard />);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByLabelText('Backup reminder')).toBeNull();
  });

  it('speaks up for a database that was never backed up', async () => {
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    expect(
      await screen.findByText(/only on this phone/, {}, { timeout: 5000 }),
    ).toBeDefined();
  });

  it('points at the settings rather than acting itself', async () => {
    // Backing up lives next to the restore it mirrors: the home screen informs,
    // it does not execute.
    await recordSessions(FIRST_REMINDER_SESSIONS);
    render(<BackupReminderCard />);

    const line = await screen.findByLabelText('Backup reminder', {}, { timeout: 5000 });
    expect(line.textContent).toMatch(/Settings/);
    expect(screen.queryByRole('button', { name: /Back up/ })).toBeNull();
  });

  it('goes quiet once the backup is done', async () => {
    await recordSessions(FIRST_REMINDER_SESSIONS);
    window.localStorage.setItem(KEY, String(Date.now()));

    render(<BackupReminderCard />);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByLabelText('Backup reminder')).toBeNull();
  });
});

describe('the export, in the settings', () => {
  const exportButton = () =>
    screen.findByRole('button', { name: /Export my data/ }, { timeout: 5000 });

  it('goes through the share sheet where there is one', async () => {
    // A downloaded file lands in Downloads and never leaves it.
    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => share.mock.calls.length).toBe(1);
    const shared = share.mock.calls[0][0] as { files: File[] };
    expect(shared.files[0].name).toMatch(/^workout-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('records the date once the share has gone through', async () => {
    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('records nothing when the user cancels the share', async () => {
    // `share` rejects with AbortError when the sheet is dismissed. Counting
    // that as a backup would silence the reminder on a promise of safety that
    // does not exist.
    //
    // The delay is not decorative: it is what tells a person deciding from a
    // browser refusing, both of which reject under the same error name.
    share.mockImplementation(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new DOMException('cancelled', 'AbortError')), 320),
        ),
    );

    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('falls back to the download when the browser refuses to share', async () => {
    // The case reported on Brave: `canShare` says yes, `share` refuses. The
    // button then did strictly nothing — the worst possible outcome for the one
    // feature standing between somebody and a lost history.
    share.mockRejectedValue(new DOMException('not allowed', 'NotAllowedError'));
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => clicked.mock.calls.length).toBe(1);
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    clicked.mockRestore();
  });

  it('falls back to the download when a refusal dresses up as a cancel', async () => {
    // Some browsers reject with AbortError having shown nothing at all. A
    // rejection that arrives instantly showed nobody a sheet.
    share.mockRejectedValue(new DOMException('blocked', 'AbortError'));
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    await recordSessions(1);
    render(<SettingsScreen />);

    await user.click(await exportButton());

    await expect.poll(() => clicked.mock.calls.length).toBe(1);
    clicked.mockRestore();
  });

  it('falls back to the download where sharing does not exist', async () => {
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

  it('shows "never" while nothing has been exported, then the date', async () => {
    // "never" is the answer that matters: an empty line would read as
    // reassurance.
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
