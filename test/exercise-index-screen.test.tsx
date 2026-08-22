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
  it('classe par muscle, et rien d’autre', async () => {
    // Un seul axe : sortir les exercices travaillés dans leur propre section
    // mettait un titre « est-ce que je l'ai fait » au milieu de titres
    // « qu'est-ce que ça travaille », et sortait le développé couché de Chest.
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

  it('garde un exercice travaillé sous son muscle', async () => {
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);

    await firstRowUnder('Quads').toContain('Squat');
  });

  it('ne le montre qu’une fois', async () => {
    await logOneSet(squat);

    render(<ExerciseIndexScreen />);
    await firstRowUnder('Quads').toContain('Squat');

    expect(screen.getAllByRole('button', { name: /^Squat/ })).toHaveLength(1);
  });

  it('le remonte en tête de son groupe', async () => {
    // Le tri « déjà travaillé d'abord » ne disparaît pas, il se déplace à
    // l'intérieur du groupe : `groupByMuscle` conserve l'ordre reçu. « Leg
    // press » est cinquième par ordre alphabétique dans Quads, donc le voir en
    // tête ne peut venir que de ce tri.
    const legPress = await exerciseByKey('leg press');
    await logOneSet(legPress);

    render(<ExerciseIndexScreen />);

    await firstRowUnder('Quads').toContain('Leg press');
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
