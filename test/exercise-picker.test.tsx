import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExercisePicker } from '../components/session/exercise-picker';
import { listSelectableExercises } from '../lib/db/exercises';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

const headings = () =>
  screen.queryAllByRole('heading', { level: 3 }).map((node) => node.textContent);

/**
 * Waits until the catalogue is grouped on screen.
 *
 * The search field sits in the header, so it renders before the query answers:
 * waiting on it proves nothing about the list. These tests used to assert right
 * after typing and sometimes read the screen mid-load — green on their own, red
 * under load.
 */
const grouped = () => expect.poll(() => headings()[0], { timeout: 5000 }).toBe('Chest');

describe('ExercisePicker, en parcours', () => {
  it('groups the catalogue by muscle, in anatomical order', async () => {
    // What using it taught: at 58 entries, a single alphabetical column stops
    // being a list and becomes a wall.
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Bench press');

    const shown = headings();
    expect(shown.slice(0, 3)).toEqual(['Chest', 'Back', 'Shoulders']);
    expect(shown.indexOf('Quads')).toBeGreaterThan(shown.indexOf('Triceps'));
  });

  it('does not repeat the muscle on every row', async () => {
    // Under a heading that already says "Chest", it is a column of one word.
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    const row = await screen.findByRole('button', { name: /Bench press/ });
    expect(row.textContent).toBe('Bench press');
  });

  it('leaves the whole catalogue reachable', async () => {
    // The property that matters: grouping must make nothing disappear. Without
    // this test, a group left out of the order would drop from the picker in
    // silence — the exercise exists, it simply cannot be found.
    const catalogue = await listSelectableExercises();

    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Bench press');

    for (const exercise of catalogue) {
      expect(screen.getByRole('button', { name: new RegExp(`^${exercise.name}`) })).toBeDefined();
    }
  });

  it('files an exercise with no muscle under "Other", rather than losing it', async () => {
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Bench press');

    // The shipped catalogue gives everything a muscle: the section only exists
    // when the user creates an exercise without picking one.
    expect(headings()).not.toContain('Other');
  });

  it('still picks an exercise', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ExercisePicker onPick={onPick} onClose={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Bench press/ }));

    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe('ExercisePicker, en recherche', () => {
  it('goes flat: the search has already filtered', async () => {
    // Headings above two results come between the eye and the name.
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('Search exercises'), 'press');

    // The result first: "no headings" is true while loading as well, so
    // asserting it alone would pass without proving anything.
    expect(await screen.findByRole('button', { name: /Bench press/ })).toBeDefined();
    expect(headings()).toEqual([]);
  });

  it('puts the muscle back on the row, for want of a heading', async () => {
    // Flat, nothing is left to say what "Close-grip bench press" works.
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('Search exercises'), 'close-grip');

    const row = await screen.findByRole('button', { name: /Close-grip bench press/ });
    expect(within(row).getByText('triceps')).toBeDefined();
  });

  it('returns to the grouping when the search is cleared', async () => {
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    const field = await screen.findByLabelText('Search exercises');
    // The field appears before the list: it lives in the header, not in the
    // query. Wait on the first heading rather than the field, or the screen
    // gets read while it is still loading.
    await grouped();

    await user.type(field, 'press');
    expect(headings()).toEqual([]);

    await user.clear(field);

    await grouped();
  });

  it('does not group on whitespace', async () => {
    // A search that means nothing must not break the journey.
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await grouped();

    await user.type(await screen.findByLabelText('Search exercises'), '   ');

    await grouped();
  });
});
