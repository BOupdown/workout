import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExercisePicker } from '../components/session/exercise-picker';
import { listSelectableExercises } from '../lib/db/exercises';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

const headings = () =>
  screen.queryAllByRole('heading', { level: 3 }).map((node) => node.textContent);

describe('ExercisePicker, en parcours', () => {
  it('classe le catalogue par muscle, dans l’ordre anatomique', async () => {
    // Le retour d'usage : à 58 entrées, une colonne alphabétique unique cesse
    // d'être une liste et devient un mur.
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Bench press');

    const shown = headings();
    expect(shown.slice(0, 3)).toEqual(['Chest', 'Back', 'Shoulders']);
    expect(shown.indexOf('Quads')).toBeGreaterThan(shown.indexOf('Triceps'));
  });

  it('ne répète pas le muscle sur chaque ligne', async () => {
    // Sous un titre qui dit déjà « Chest », c'est une colonne du même mot.
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    const row = await screen.findByRole('button', { name: /Bench press/ });
    expect(row.textContent).toBe('Bench press');
  });

  it('laisse tout le catalogue atteignable', async () => {
    // La propriété qui compte : classer ne doit rien faire disparaître. Sans
    // ce test, un groupe oublié dans l'ordre sortirait du sélecteur en
    // silence — l'exercice existe, il est juste introuvable.
    const catalogue = await listSelectableExercises();

    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Bench press');

    for (const exercise of catalogue) {
      expect(screen.getByRole('button', { name: new RegExp(`^${exercise.name}`) })).toBeDefined();
    }
  });

  it('range un exercice sans muscle sous « Other », plutôt que de le perdre', async () => {
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Bench press');

    // Le catalogue livré donne un muscle à tout : la section n'existe que si
    // l'utilisateur crée un exercice sans en choisir un.
    expect(headings()).not.toContain('Other');
  });

  it('choisit toujours un exercice', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ExercisePicker onPick={onPick} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Bench press/ }));

    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('ExercisePicker, en recherche', () => {
  it('passe à plat : la recherche a déjà filtré', async () => {
    // Des titres au-dessus de deux résultats se mettent entre l'œil et le nom.
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('Search exercises'), 'press');

    expect(headings()).toEqual([]);
    expect(screen.getByRole('button', { name: /Bench press/ })).toBeDefined();
  });

  it('remet le muscle sur la ligne, faute de titre', async () => {
    // À plat, plus rien ne dit ce que travaille « Close-grip bench press ».
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('Search exercises'), 'close-grip');

    const row = await screen.findByRole('button', { name: /Close-grip bench press/ });
    expect(within(row).getByText('triceps')).toBeDefined();
  });

  it('revient au classement quand la recherche est effacée', async () => {
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    const field = await screen.findByLabelText('Search exercises');
    await user.type(field, 'press');
    expect(headings()).toEqual([]);

    await user.clear(field);

    expect(headings()[0]).toBe('Chest');
  });

  it('ne classe pas les blancs', async () => {
    // Une recherche vide de sens ne doit pas casser le parcours.
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('Search exercises'), '   ');

    expect(headings()[0]).toBe('Chest');
  });
});
