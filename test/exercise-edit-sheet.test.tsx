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
  it('leaves everything editable while no set exists', async () => {
    const fresh = await createExercise({ name: 'Sandbag carry', loadType: 'external', metric: 'reps' });

    render(<ExerciseEditSheet exercise={fresh} onSaved={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);

    await expect.poll(() => screen.queryByText(/already recorded/)).toBeNull();
    for (const control of natureControls()) {
      expect((control as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('freezes the nature once a set exists, and says how many', async () => {
    // This is `ExerciseInUseError`: changing what an exercise measures would
    // rewrite the meaning of the sets already logged. The screen prevents it
    // rather than reporting it.
    await logOneSet(squat);

    render(<ExerciseEditSheet exercise={squat} onSaved={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText(/1 set already recorded/)).toBeDefined();
    for (const control of natureControls()) {
      expect((control as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('leaves the name editable despite the freeze', async () => {
    // Fixing a typo changes the meaning of no set.
    const user = userEvent.setup();
    const onSaved = vi.fn();
    await logOneSet(squat);

    render(<ExerciseEditSheet exercise={squat} onSaved={onSaved} onDeleted={vi.fn()} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Exercise name');
    expect((name as HTMLInputElement).disabled).toBe(false);

    await user.clear(name);
    await user.type(name, 'Back squat');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await expect.poll(async () => (await db.exercises.get(squat.id))?.name).toBe('Back squat');
    expect(onSaved).toHaveBeenCalled();
  });

  it('sending back an unchanged nature is a no-op, not a refusal', async () => {
    // The real risk of the freeze: the form sends loadType/metric/perSide back
    // as they were, and `updateExercise` must count only actual changes.
    const user = userEvent.setup();
    await logOneSet(squat);

    render(<ExerciseEditSheet exercise={squat} onSaved={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText(/1 set already recorded/);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect((await db.exercises.get(squat.id))?.name).toBe(squat.name);
  });

  it('refuses a rename onto a name already taken, writing nothing', async () => {
    const user = userEvent.setup();
    const fresh = await createExercise({ name: 'Sandbag carry', loadType: 'external', metric: 'reps' });

    render(<ExerciseEditSheet exercise={fresh} onSaved={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);

    const name = await screen.findByLabelText('Exercise name');
    await user.clear(name);
    await user.type(name, squat.name);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect((await db.exercises.get(fresh.id))?.name).toBe('Sandbag carry');
  });

  it('archives behind a confirmation, losing no history', async () => {
    const user = userEvent.setup();
    await logOneSet(squat);
    const setsBefore = await db.sets.count();

    render(<ExerciseEditSheet exercise={squat} onSaved={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Archive this exercise/ }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    await expect
      .poll(async () => (await db.exercises.get(squat.id))?.archivedAt !== undefined)
      .toBe(true);
    expect(await db.sets.count()).toBe(setsBefore);
  });

  it('offers to restore, with no confirmation, an archived exercise', async () => {
    const user = userEvent.setup();
    const archived = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });
    await db.exercises.update(archived.id, { archivedAt: Date.now() });
    const stored = await db.exercises.get(archived.id);

    render(<ExerciseEditSheet exercise={stored!} onSaved={vi.fn()} onDeleted={vi.fn()} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Restore this exercise/ }));

    await expect
      .poll(async () => (await db.exercises.get(archived.id))?.archivedAt)
      .toBeUndefined();
  });
});

describe('supprimer depuis la feuille', () => {
  it('offers deletion for an exercise never performed', async () => {
    const fresh = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });

    render(
      <ExerciseEditSheet
        exercise={fresh}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: /Delete this exercise/ })).toBeDefined();
  });

  it('stops offering it as soon as one set exists', async () => {
    // The rule is not decorative: without it the screen would offer a gesture
    // the database refuses, and which would erase training if it went through.
    await logOneSet(squat);

    render(
      <ExerciseEditSheet
        exercise={squat}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText(/1 set already recorded/);
    expect(screen.queryByRole('button', { name: /Delete this exercise/ })).toBeNull();
  });

  it('holds it back until the count is known', async () => {
    // `useLiveQuery` returns `undefined` before it answers. Treating that as
    // zero would flash "Delete" for a fraction of a second on an exercise laden
    // with history — the one moment where the gesture is wrong.
    await logOneSet(squat);

    render(
      <ExerciseEditSheet
        exercise={squat}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /Delete this exercise/ })).toBeNull();
  });

  it('deletes behind a confirmation, and tells the parent', async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const fresh = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });

    render(
      <ExerciseEditSheet
        exercise={fresh}
        onSaved={vi.fn()}
        onDeleted={onDeleted}
        onClose={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Delete this exercise/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await expect.poll(async () => await db.exercises.get(fresh.id)).toBeUndefined();
    expect(onDeleted).toHaveBeenCalled();
  });

  it('deletes nothing until it has been confirmed', async () => {
    const user = userEvent.setup();
    const fresh = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
    });

    render(
      <ExerciseEditSheet
        exercise={fresh}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /Delete this exercise/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await db.exercises.get(fresh.id)).toBeDefined();
  });
});
