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

describe('SetEditorSheet — ce qui qualifie une série', () => {
  it('reste replié sur une série nue', async () => {
    // La feuille sert d'abord à corriger un chiffre : le reste ne doit pas
    // pousser « Save » vers le bas.
    renderEditor(await loggedSet());

    const disclosure = screen.getByRole('button', { name: /How it felt/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Raise the RPE')).toBeNull();
  });

  it('s’ouvre seule et résume quand la série porte déjà quelque chose', async () => {
    // Une note qu'on ne voit pas est une note qu'on ne corrigera jamais.
    renderEditor(await loggedSet({ rpe: 8, isFailure: true, notes: 'épaule' }));

    const disclosure = screen.getByRole('button', { name: /RPE 8/ });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure.textContent).toContain('to failure');
    expect(disclosure.textContent).toContain('note');
  });

  it('enregistre RPE, échec et note', async () => {
    const user = userEvent.setup();
    const set = await loggedSet();
    renderEditor(set);

    await user.click(screen.getByRole('button', { name: /How it felt/ }));
    await user.click(screen.getByLabelText('Raise the RPE')); // unset → 8
    await user.click(screen.getByLabelText('Raise the RPE')); // → 8.5
    await user.click(screen.getByRole('button', { name: /Taken to failure/ }));
    await user.type(screen.getByLabelText('Note on this set'), '  épaule droite  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expect.poll(async () => (await stored(set.id))?.rpe).toBe(8.5);
    const saved = await stored(set.id);
    expect(saved?.isFailure).toBe(true);
    expect(saved?.notes).toBe('épaule droite');
  });

  it('n’écrit ni false ni chaîne vide en effaçant', async () => {
    const user = userEvent.setup();
    const set = await loggedSet({ rpe: 9, isFailure: true, notes: 'gêne' });
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

  it('laisse les mesures intactes quand seuls les qualifiers changent', async () => {
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

  it('ne descend pas sous 1 ni au-dessus de 10', async () => {
    const user = userEvent.setup();
    renderEditor(await loggedSet({ rpe: 10 }));

    // Déjà au plafond : le bouton doit être hors service, pas produire 10.5.
    expect((screen.getByLabelText('Raise the RPE') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByLabelText('Lower the RPE'));
    expect(screen.getByLabelText('Lower the RPE').nextElementSibling?.textContent).toBe('9.5');
  });
});
