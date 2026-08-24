import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ExerciseIndexScreen } from '../components/progression/exercise-index-screen';
import { archiveExercise } from '../lib/db/exercises';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
});

async function logOneSet(exercise: Exercise) {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, exercise.id);
  await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
}

const headings = () =>
  screen.queryAllByRole('heading', { level: 3 }).map((node) => node.textContent);

describe('ExerciseIndexScreen', () => {
  it('groups by muscle, and by nothing else', async () => {
    // One axis only: pulling the trained exercises into their own section put
    // a "have I done it" heading among "what does it work" headings, and took
    // the bench press out of Chest.
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);

    await expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Chest');
    expect(headings()).not.toContain('Trained');
  });

  /**
   * The first row under a heading, once it settles.
   *
   * Polled on the row itself rather than on the heading: the sections render
   * as soon as the catalogue lands, while the trained-first order only applies
   * once the set counts arrive. Waiting on the heading meant asserting on an
   * order that had not happened yet — which passed alone and failed under load.
   */
  const firstRowUnder = (label: string) =>
    expect.poll(
      () =>
        screen
          .queryByRole('heading', { level: 3, name: label })
          ?.parentElement?.querySelector('li')?.textContent,
      { timeout: 5000 },
    );

  it('keeps a trained exercise under its muscle', async () => {
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);

    await firstRowUnder('Quads').toContain('Squat');
  });

  it('shows it only once', async () => {
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);
    await firstRowUnder('Quads').toContain('Squat');

    expect(screen.getAllByRole('button', { name: /^Squat/ })).toHaveLength(1);
  });

  it('lifts it to the head of its group', async () => {
    // The "trained first" ordering does not disappear, it moves inside the
    // group: `groupByMuscle` preserves the order it is given. "Leg press" is
    // fifth alphabetically within Quads, so seeing it at the head can only come
    // from that ordering.
    const legPress = await exerciseByKey('leg press');
    await logOneSet(legPress);

    render(<ExerciseIndexScreen />);

    await firstRowUnder('Quads').toContain('Leg press');
  });

  it('stays flat while searching', async () => {
    const user = userEvent.setup();
    render(<ExerciseIndexScreen />);
    await expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Chest');

    await user.type(screen.getByLabelText('Search exercises'), 'squat');

    expect(headings()).toEqual([]);
    expect(screen.getByRole('button', { name: /^Squat/ })).toBeDefined();
  });

  it('stays flat in the archive', async () => {
    // A handful of rows: grouping them would give a column of sections holding
    // one item each.
    const user = userEvent.setup();
    await archiveExercise(squat.id);

    render(<ExerciseIndexScreen />);

    await user.click(await screen.findByRole('button', { name: /Archived \(1\)/ }));

    await expect.poll(() => screen.queryByRole('button', { name: /^Squat/ })).not.toBeNull();
    expect(headings()).toEqual([]);
  });
});
