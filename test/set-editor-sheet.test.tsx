import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SetEditorSheet } from '../components/session/set-editor-sheet';
import { db } from '../lib/db/db';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise, SetEntry } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
});

async function loggedSet(over: Partial<SetEntry> = {}): Promise<SetEntry> {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, squat.id);
  const set = await createSet({
    sessionExerciseId: block.id,
    weightKg: 100,
    reps: 5,
    kind: 'work',
  });

  if (Object.keys(over).length > 0) {
    await db.sets.update(set.id, over);
  }
  return (await db.sets.get(set.id))!;
}

function renderEditor(set: SetEntry, onClose = vi.fn()) {
  render(
    <SetEditorSheet set={set} exercise={squat} position={1} unit="kg" onClose={onClose} />,
  );
  return onClose;
}

const stored = (id: string) => db.sets.get(id);

describe('SetEditorSheet — what qualifies a set', () => {
  it('stays folded on a bare set', async () => {
    // The sheet is there first to correct a figure: the rest must not push
    // "Save" down the screen.
    renderEditor(await loggedSet());

    const disclosure = screen.getByRole('button', { name: /How it felt/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Raise the RPE')).toBeNull();
  });

  it('opens itself and sums up when the set already carries something', async () => {
    // A note nobody sees is a note nobody will ever correct.
    renderEditor(await loggedSet({ rpe: 8, isFailure: true, notes: 'shoulder' }));

    const disclosure = screen.getByRole('button', { name: /RPE 8/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure.textContent).toContain('to failure');
    expect(disclosure.textContent).toContain('note');
  });

  it('stores RPE, failure and note', async () => {
    const user = userEvent.setup();
    const set = await loggedSet();
    renderEditor(set);

    await user.click(screen.getByRole('button', { name: /How it felt/ }));
    await user.click(screen.getByLabelText('Raise the RPE')); // unset → 8
    await user.click(screen.getByLabelText('Raise the RPE')); // → 8.5
    await user.click(screen.getByRole('button', { name: /Taken to failure/ }));
    await user.type(screen.getByLabelText('Note on this set'), '  right shoulder  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expect.poll(async () => (await stored(set.id))?.rpe).toBe(8.5);
    const saved = await stored(set.id);
    expect(saved?.isFailure).toBe(true);
    expect(saved?.notes).toBe('right shoulder');
  });

  it('writes neither false nor an empty string when cleared', async () => {
    const user = userEvent.setup();
    const set = await loggedSet({ rpe: 9, isFailure: true, notes: 'twinge' });
    renderEditor(set);

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: /Taken to failure/ }));
    await user.clear(screen.getByLabelText('Note on this set'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expect
      .poll(async () => {
        const saved = await stored(set.id);
        return saved === undefined ? null : ['rpe', 'isFailure', 'notes'].filter((k) => k in saved);
      })
      .toEqual([]);
  });

  it('leaves the measures untouched when only the qualifiers change', async () => {
    const user = userEvent.setup();
    const set = await loggedSet();
    renderEditor(set);

    await user.click(screen.getByRole('button', { name: /How it felt/ }));
    await user.click(screen.getByLabelText('Raise the RPE'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expect.poll(async () => (await stored(set.id))?.rpe).toBe(8);
    const saved = await stored(set.id);
    expect(saved?.weightKg).toBe(100);
    expect(saved?.reps).toBe(5);
  });

  it('goes neither below 1 nor above 10', async () => {
    const user = userEvent.setup();
    renderEditor(await loggedSet({ rpe: 10 }));

    // Already at the ceiling: the button has to be out of service, not
    // produce 10.5.
    expect((screen.getByLabelText('Raise the RPE') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText('Lower the RPE'));
    expect(screen.getByLabelText('Lower the RPE').nextElementSibling?.textContent).toBe('9.5');
  });
});
