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

describe('the Progress selector', () => {
  it('opens on the exercises by default', async () => {
    render(<ExerciseIndexScreen />);

    const exercises = await screen.findByRole('tab', { name: /exercises/i });
    expect(exercises.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Search exercises')).toBeDefined();
  });

  it('switches to the calendar and back', async () => {
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
  it('renders at most six full weeks, every one of seven days', async () => {
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

  it('marks a day that was trained', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await endSession(session.id);

    render(<CalendarView />);
    await dayCell(today());

    // The cell exists before the query has answered: it is the label that has
    // to be waited for, not the element.
    await expect
      .poll(() => screen.getByRole('button', { name: new RegExp(`^${today()}`) }).getAttribute('aria-label'))
      .toMatch(/trained/);
  });

  it('leaves a day with no session unmarked', async () => {
    // A weight acts as the witness: until it is on screen the queries have not
    // answered, and finding nothing would prove nothing.
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

  it('records a weight on a day with no session — once impossible', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    await user.click(await dayCell(today()));

    const sheet = await screen.findByRole('region', { name: /Bodyweight for/ });
    await user.type(within(sheet).getByLabelText('Bodyweight'), '77.2');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await expect.poll(async () => (await getBodyWeight(today()))?.weightKg).toBe(77.2);
  });

  it('shows a weight entered somewhere else', async () => {
    // The invariant behind the move: the session and the calendar read the
    // same value, so a weight entered during a session appears here with
    // nothing further to do.
    await setBodyWeight(today(), 80.5);

    render(<CalendarView />);
    await dayCell(today());

    await expect
      .poll(() => screen.getByRole('button', { name: new RegExp(`^${today()}`) }).getAttribute('aria-label'))
      .toMatch(/80\.5 kg/);
  });

  it('clears a weight when the field is emptied', async () => {
    const user = userEvent.setup();
    await setBodyWeight(today(), 80.5);

    render(<CalendarView />);
    await user.click(await dayCell(today()));

    const sheet = await screen.findByRole('region', { name: /Bodyweight for/ });
    await user.clear(within(sheet).getByLabelText('Bodyweight'));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await expect.poll(async () => await getBodyWeight(today())).toBeUndefined();
  });

  it('changes month without losing the grid', async () => {
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
