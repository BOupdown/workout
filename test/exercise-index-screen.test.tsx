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
  it('garde ce qui a été fait en tête, et classe le reste par muscle', async () => {
    // Les deux à la fois : le tri « déjà travaillé d'abord » reste ce que cet
    // écran raconte, le classement ne s'applique qu'à la longue queue.
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);

    await expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Trained');
    expect(headings()[1]).toBe('Chest');
  });

  it('ne montre pas deux fois un exercice travaillé', async () => {
    // Il monte dans « Trained » : le laisser aussi sous son muscle en ferait
    // deux lignes pour un seul exercice.
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);
    await expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Trained');

    expect(screen.getAllByRole('button', { name: /^Squat/ })).toHaveLength(1);
  });

  it('n’affiche pas de section « Trained » vide', async () => {
    render(<ExerciseIndexScreen />);

    await expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Chest');
  });

  it('reste à plat pendant une recherche', async () => {
    const user = userEvent.setup();
    render(<ExerciseIndexScreen />);
    await expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Chest');

    await user.type(screen.getByLabelText('Search exercises'), 'squat');

    expect(headings()).toEqual([]);
    expect(screen.getByRole('button', { name: /^Squat/ })).toBeDefined();
  });

  it('reste à plat dans les archives', async () => {
    // Une poignée de lignes : les classer donnerait une colonne de sections
    // d'un seul élément.
    const user = userEvent.setup();
    await archiveExercise(squat.id);

    render(<ExerciseIndexScreen />);

    await user.click(await screen.findByRole('button', { name: /Archived \(1\)/ }));

    await expect.poll(() => screen.queryByRole('button', { name: /^Squat/ })).not.toBeNull();
    expect(headings()).toEqual([]);
  });
});
