import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseEditSheet } from '../components/exercises/exercise-edit-sheet';
import { db } from '../lib/db/db';
import { createExercise } from '../lib/db/exercises';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
});

/** Gives `exercise` a real history, which is what freezes its nature. */
async function logOneSet(exercise: Exercise) {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, exercise.id);
  await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
}

const natureControls = () => [
  screen.getByRole('button', { name: /With a load/ }),
  screen.getByRole('button', { name: /Bodyweight$|Bodyweight\b/ }),
  screen.getByRole('button', { name: /^Reps$/ }),
  screen.getByRole('button', { name: /^Time$/ }),
  screen.getByRole('button', { name: /Counted per side/ }),
];

describe('ExerciseEditSheet', () => {
  it('laisse tout modifiable tant qu’aucune série n’existe', async () => {
    const fresh = await createExercise({ name: 'Face pull', loadType: 'external', metric: 'reps' });

    render(<ExerciseEditSheet exercise={fresh} onSaved={vi.fn()} onClose={vi.fn()} />);

    await expect.poll(() => screen.queryByText(/already recorded/)).toBeNull();
    for (const control of natureControls()) {
      expect((control as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('gèle la nature dès qu’une série existe, et dit combien', async () => {
    // C'est `ExerciseInUseError` : changer ce que mesure un exercice réécrirait
    // le sens des séries déjà là. L'écran l'empêche au lieu de le rapporter.
    await logOneSet(squat);

    render(<ExerciseEditSheet exercise={squat} onSaved={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText(/1 set already recorded/)).toBeDefined();
    for (const control of natureControls()) {
      expect((control as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('laisse le nom modifiable malgré le gel', async () => {
    // Corriger une faute de frappe ne change le sens d'aucune série.
    const user = userEvent.setup();
    const onSaved = vi.fn();
    await logOneSet(squat);

    render(<ExerciseEditSheet exercise={squat} onSaved={onSaved} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Exercise name');
    expect((name as HTMLInputElement).disabled).toBe(false);

    await user.clear(name);
    await user.type(name, 'Back squat');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await expect.poll(async () => (await db.exercises.get(squat.id))?.name).toBe('Back squat');
    expect(onSaved).toHaveBeenCalled();
  });

  it('renvoyer une nature inchangée reste un no-op, pas un rejet', async () => {
    // Le vrai risque du gel : le formulaire réémet loadType/metric/perSide tels
    // quels, et `updateExercise` ne doit compter que les changements effectifs.
    const user = userEvent.setup();
    await logOneSet(squat);

    render(<ExerciseEditSheet exercise={squat} onSaved={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/1 set already recorded/);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect((await db.exercises.get(squat.id))?.name).toBe(squat.name);
  });

  it('refuse un renommage vers un nom déjà pris, sans écrire', async () => {
    const user = userEvent.setup();
    const fresh = await createExercise({ name: 'Face pull', loadType: 'external', metric: 'reps' });

    render(<ExerciseEditSheet exercise={fresh} onSaved={vi.fn()} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Exercise name');
    await user.clear(name);
    await user.type(name, squat.name);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect((await db.exercises.get(fresh.id))?.name).toBe('Face pull');
  });

  it('archive derrière une confirmation, sans perdre l’historique', async () => {
    const user = userEvent.setup();
    await logOneSet(squat);
    const setsBefore = await db.sets.count();

    render(<ExerciseEditSheet exercise={squat} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Archive this exercise/ }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await expect
      .poll(async () => (await db.exercises.get(squat.id))?.archivedAt !== undefined)
      .toBe(true);
    expect(await db.sets.count()).toBe(setsBefore);
  });

  it('propose la restauration, sans confirmation, sur un exercice archivé', async () => {
    const user = userEvent.setup();
    const archived = await createExercise({
      name: 'Face pull',
      loadType: 'external',
      metric: 'reps',
    });
    await db.exercises.update(archived.id, { archivedAt: Date.now() });
    const stored = await db.exercises.get(archived.id);

    render(<ExerciseEditSheet exercise={stored!} onSaved={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Restore this exercise/ }));

    await expect
      .poll(async () => (await db.exercises.get(archived.id))?.archivedAt)
      .toBeUndefined();
  });
});
