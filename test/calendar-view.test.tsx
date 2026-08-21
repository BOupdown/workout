import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ExerciseIndexScreen } from '../components/progression/exercise-index-screen';
import { CalendarView } from '../components/progression/calendar-view';
import { getBodyWeight, setBodyWeight } from '../lib/db/bodyweight';
import { toLocalDate } from '../lib/db/keys';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;
const today = () => toLocalDate(Date.now());

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
  window.localStorage.clear();
});

const dayCell = (date: string) =>
  screen.findByRole('button', { name: new RegExp(`^${date}`) }, { timeout: 5000 });

describe('le sélecteur de Progress', () => {
  it('ouvre les exercices par défaut', async () => {
    render(<ExerciseIndexScreen />);

    const exercises = await screen.findByRole('tab', { name: /exercises/i });
    expect(exercises.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Search exercises')).toBeDefined();
  });

  it('bascule sur le calendrier et en revient', async () => {
    const user = userEvent.setup();
    render(<ExerciseIndexScreen />);

    await user.click(await screen.findByRole('tab', { name: /calendar/i }));
    expect(await screen.findByRole('button', { name: 'Previous month' })).toBeDefined();
    expect(screen.queryByLabelText('Search exercises')).toBeNull();

    await user.click(screen.getByRole('tab', { name: /exercises/i }));
    expect(await screen.findByLabelText('Search exercises')).toBeDefined();
  });
});

describe('le calendrier', () => {
  it('rend six semaines pleines au maximum, toutes de sept jours', async () => {
    render(<CalendarView />);

    const cells = await screen.findAllByRole(
      'button',
      { name: /^\d{4}-\d{2}-\d{2}/ },
      { timeout: 5000 },
    );
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells.length).toBeLessThanOrEqual(42);
  });

  it('marque un jour où l’on s’est entraîné', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await endSession(session.id);

    render(<CalendarView />);
    await dayCell(today());

    // La cellule existe avant que la requête n'ait répondu : c'est le libellé
    // qu'il faut attendre, pas l'élément.
    await expect
      .poll(() => screen.getByRole('button', { name: new RegExp(`^${today()}`) }).getAttribute('aria-label'))
      .toMatch(/trained/);
  });

  it('ne marque pas un jour sans séance', async () => {
    // Un poids sert de témoin : tant qu'il n'est pas affiché, les requêtes
    // n'ont pas répondu et constater une absence ne prouverait rien.
    await setBodyWeight(today(), 80.5);

    render(<CalendarView />);
    await dayCell(today());

    await expect
      .poll(() => screen.getByRole('button', { name: new RegExp(`^${today()}`) }).getAttribute('aria-label'))
      .toMatch(/80\.5 kg/);

    expect(
      screen.getByRole('button', { name: new RegExp(`^${today()}`) }).getAttribute('aria-label'),
    ).not.toMatch(/trained/);
  });

  it('enregistre un poids un jour sans séance — ce qui était impossible avant', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    await user.click(await dayCell(today()));

    const sheet = await screen.findByRole('region', { name: /Bodyweight for/ });
    await user.type(within(sheet).getByLabelText('Bodyweight'), '77.2');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await expect.poll(async () => (await getBodyWeight(today()))?.weightKg).toBe(77.2);
  });

  it('affiche un poids saisi ailleurs', async () => {
    // L'invariant du déménagement : la séance et le calendrier lisent la même
    // valeur, donc un poids noté en séance apparaît ici sans rien de plus.
    await setBodyWeight(today(), 80.5);

    render(<CalendarView />);
    await dayCell(today());

    await expect
      .poll(() => screen.getByRole('button', { name: new RegExp(`^${today()}`) }).getAttribute('aria-label'))
      .toMatch(/80\.5 kg/);
  });

  it('efface un poids quand on vide le champ', async () => {
    const user = userEvent.setup();
    await setBodyWeight(today(), 80.5);

    render(<CalendarView />);
    await user.click(await dayCell(today()));

    const sheet = await screen.findByRole('region', { name: /Bodyweight for/ });
    await user.clear(within(sheet).getByLabelText('Bodyweight'));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await expect.poll(async () => await getBodyWeight(today())).toBeUndefined();
  });

  it('change de mois sans perdre la grille', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    const title = (await screen.findAllByRole('heading'))[0].textContent;
    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await expect
      .poll(() => screen.getAllByRole('heading')[0].textContent)
      .not.toBe(title);

    const cells = screen.getAllByRole('button', { name: /^\d{4}-\d{2}-\d{2}/ });
    expect(cells.length % 7).toBe(0);
  });
});
