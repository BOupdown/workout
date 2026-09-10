import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActiveSessionScreen } from '../components/session/active-session-screen';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import { archiveExercise } from '../lib/db/exercises';
import { createSet } from '../lib/db/sets';
import { db } from '../lib/db/db';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
  pushUps = await exerciseByKey('push ups');
  window.localStorage.clear();
});

/** A session holding one exercise that already carries a set. */
async function sessionWithHistory() {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, squat.id);
  await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
  return { session, block };
}

const savedSets = () => db.sets.count();

/** A finished session, then an empty current block of the same exercise. */
async function currentBlockAfter(values: Array<{ weightKg: number; reps: number }>) {
  const { session: previous } = await startSession({ startedAt: Date.now() - 60_000 });
  const previousBlock = await addExerciseToSession(previous.id, squat.id);
  for (const value of values) {
    await createSet({ sessionExerciseId: previousBlock.id, ...value, kind: 'work' });
  }
  await endSession(previous.id);

  const { session: current } = await startSession();
  const currentBlock = await addExerciseToSession(current.id, squat.id);
  return { previousBlock, currentBlock };
}

describe('the two-tap promise', () => {
  it('logs a set in two taps when the exercise is already in the session', async () => {
    // This is the app's whole thesis, and until now no test held it: one tap on
    // the row (which activates it *and* reloads the draft), one tap on Save.
    const user = userEvent.setup();
    await sessionWithHistory();

    render(<ActiveSessionScreen />);

    const row = await screen.findByRole('button', { name: /^Squat/ });
    await user.click(row);

    const save = await screen.findByRole('button', { name: /Save set/ });
    await user.click(save);

    await expect.poll(savedSets).toBe(2);
  });

  it('repeats a set identically in a single tap', async () => {
    // The draft is not cleared after a save: the same load and the same reps go
    // again with nothing to type.
    const user = userEvent.setup();
    await sessionWithHistory();

    render(<ActiveSessionScreen />);

    const save = await screen.findByRole('button', { name: /Save set/ });
    await user.click(save);
    await expect.poll(savedSets).toBe(2);

    await user.click(save);
    await expect.poll(savedSets).toBe(3);

    const stored = await db.sets.toArray();
    const logged = stored.filter((set) => set.weightKg === 100 && set.reps === 5);
    expect(logged).toHaveLength(3);
  });

  it('prefills the entry with the previous set', async () => {
    await sessionWithHistory();
    render(<ActiveSessionScreen />);

    const panel = await screen.findByRole('region', { name: /Log a set of Squat/ });
    const load = within(panel).getByLabelText('Load') as HTMLInputElement;
    const reps = within(panel).getByLabelText('Reps') as HTMLInputElement;

    expect(load.value).toBe('100');
    expect(reps.value).toBe('5');
  });
});

describe('set-number defaults from the previous session', () => {
  it('matches first and second sets by their displayed rank', async () => {
    const user = userEvent.setup();
    await currentBlockAfter([
      { weightKg: 90, reps: 8 },
      { weightKg: 100, reps: 5 },
    ]);

    render(<ActiveSessionScreen />);
    const panel = await screen.findByRole('region', { name: /Log a set of Squat/ });
    const load = within(panel).getByLabelText('Load') as HTMLInputElement;
    const reps = within(panel).getByLabelText('Reps') as HTMLInputElement;

    await expect.poll(() => load.value).toBe('90');
    expect(reps.value).toBe('8');

    await user.click(within(panel).getByRole('button', { name: /Save set/ }));
    await expect.poll(() => savedSets()).toBe(3);
    await expect.poll(() => load.value).toBe('100');
    expect(reps.value).toBe('5');
  });

  it('keeps the current default when the previous session has no matching rank', async () => {
    const user = userEvent.setup();
    await currentBlockAfter([{ weightKg: 90, reps: 8 }]);

    render(<ActiveSessionScreen />);
    const panel = await screen.findByRole('region', { name: /Log a set of Squat/ });
    await expect.poll(() => (within(panel).getByLabelText('Load') as HTMLInputElement).value).toBe('90');
    await user.click(within(panel).getByRole('button', { name: /Save set/ }));
    await expect.poll(() => savedSets()).toBe(2);

    expect((within(panel).getByLabelText('Load') as HTMLInputElement).value).toBe('90');
    expect((within(panel).getByLabelText('Reps') as HTMLInputElement).value).toBe('8');
  });

  it('never overwrites a value the user has started typing while history refreshes', async () => {
    const user = userEvent.setup();
    const { previousBlock } = await currentBlockAfter([{ weightKg: 90, reps: 8 }]);

    render(<ActiveSessionScreen />);
    const panel = await screen.findByRole('region', { name: /Log a set of Squat/ });
    const load = within(panel).getByLabelText('Load') as HTMLInputElement;
    await expect.poll(() => load.value).toBe('90');
    await user.clear(load);
    await user.type(load, '95');

    // A write to the source block makes the live history query run again.
    await createSet({ sessionExerciseId: previousBlock.id, weightKg: 100, reps: 5 });
    await expect.poll(() => load.value).toBe('95');
  });
});

describe('the rest timer and the reach of the thumb', () => {
  it('starts a rest as soon as a set is written', async () => {
    const user = userEvent.setup();
    await sessionWithHistory();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: /Save set/ }));

    expect(await screen.findByRole('region', { name: 'Rest timer' })).toBeDefined();
    expect(window.localStorage.getItem('workout.rest-timer')).toContain('durationSec');
  });

  it('never slips the bar between the list and the entry panel', async () => {
    // The invariant protecting the single tap: the bar takes its place *above*
    // the list, never between the list and the panel. Without that it would
    // push "Save set" upwards at the very instant the set is logged, moving the
    // target out from under the thumb. Asserted on DOM order, there being no
    // layout under jsdom.
    const user = userEvent.setup();
    await sessionWithHistory();

    const { container } = render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: /Save set/ }));
    await screen.findByRole('region', { name: 'Rest timer' });

    const main = container.querySelector('main');
    expect(main).not.toBeNull();

    const children = [...main!.children];
    const restIndex = children.findIndex((el) => el.getAttribute('aria-label') === 'Rest timer');
    const panelIndex = children.findIndex((el) =>
      (el.getAttribute('aria-label') ?? '').startsWith('Log a set of'),
    );

    expect(restIndex).toBeGreaterThanOrEqual(0);
    expect(panelIndex).toBe(children.length - 1);
    expect(restIndex).toBeLessThan(panelIndex - 1);
  });

  it('leaves no rest running once the session is over', async () => {
    const user = userEvent.setup();
    await sessionWithHistory();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: /Save set/ }));
    await screen.findByRole('region', { name: 'Rest timer' });

    await user.click(screen.getByRole('button', { name: 'Finish' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    await expect.poll(() => window.localStorage.getItem('workout.rest-timer')).toBeNull();
  });
});

describe('le record personnel', () => {
  it('marks the set that holds the record', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
    await createSet({ sessionExerciseId: block.id, weightKg: 110, reps: 3, kind: 'work' });

    render(<ActiveSessionScreen />);

    await expect
      .poll(() => screen.queryAllByRole('button', { name: /personal record/ }).length)
      .toBe(1);

    const marked = screen.getByRole('button', { name: /personal record/ });
    expect(marked.getAttribute('aria-label')).toContain('110');
  });

  it('moves the mark when a heavier set arrives', async () => {
    // The point of deriving it: nothing is remembered at the moment of writing.
    const user = userEvent.setup();
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });

    render(<ActiveSessionScreen />);

    await expect
      .poll(() => screen.queryByRole('button', { name: /personal record/ })?.getAttribute('aria-label'))
      .toContain('100');

    const panel = await screen.findByRole('region', { name: /Log a set of Squat/ });
    const load = within(panel).getByLabelText('Load') as HTMLInputElement;
    await user.clear(load);
    await user.type(load, '120');
    await user.click(screen.getByRole('button', { name: /Save set/ }));

    await expect
      .poll(() => screen.queryByRole('button', { name: /personal record/ })?.getAttribute('aria-label'))
      .toContain('120');
    expect(screen.queryAllByRole('button', { name: /personal record/ })).toHaveLength(1);
  });

  it('marks no warm-up, however heavy', async () => {
    // Deliberately modest. Excluding warm-ups is proven on `recordSet` in
    // progression.test.ts, the only place it is reachable: here
    // `recentSetsForExercise` has already set them aside before the rule
    // applies. This test observes the result, it does not prove the rule —
    // checked by mutation, it does not fail when the rule is removed.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
    await createSet({ sessionExerciseId: block.id, weightKg: 200, reps: 1, kind: 'warmup' });

    render(<ActiveSessionScreen />);

    await expect
      .poll(() => screen.queryAllByRole('button', { name: /personal record/ }).length)
      .toBe(1);
    expect(
      screen.getByRole('button', { name: /personal record/ }).getAttribute('aria-label'),
    ).toContain('100');
  });

  it('marks nothing when no work set exists', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 60, reps: 10, kind: 'warmup' });

    render(<ActiveSessionScreen />);

    await screen.findByRole('button', { name: /^Squat/ });
    await expect
      .poll(() => screen.queryAllByRole('button', { name: /personal record/ }).length)
      .toBe(0);
  });
});

describe('starting again from a past session', () => {
  /** A finished session, optionally named, laid out with two exercises. */
  async function finishedSession(title?: string) {
    const { session } = await startSession(title === undefined ? {} : { title });
    const block = await addExerciseToSession(session.id, squat.id);
    await addExerciseToSession(session.id, pushUps.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });
    await endSession(session.id);
    return session;
  }

  const openPicker = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('button', { name: /Start from a past session/ }));
    // Scoped to the picker: the last-session card behind it carries the same
    // name, and an unscoped query lands there instead — which opens history.
    return within(await screen.findByRole('list', { name: 'Past sessions' }));
  };

  it('reopens the chosen layout, empty of sets', async () => {
    // The moment the two-tap promise did not hold: starting meant adding every
    // exercise back by hand.
    const user = userEvent.setup();
    await finishedSession('Push A');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);

    await user.click(picker.getByRole('button', { name: /Push A/ }));

    expect(await screen.findByRole('button', { name: /^Squat/ }, { timeout: 5000 })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Push-ups/ })).toBeDefined();
    // A single set in the database: the one from the original session.
    await expect.poll(savedSets).toBe(1);
  });

  it('lets you choose which one, not merely the last', async () => {
    // The flaw in the first version: on a split, the session you want to reuse
    // is almost never the one you have just done.
    const user = userEvent.setup();
    await finishedSession('Push A');
    await finishedSession('Legs');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);

    await user.click(picker.getByRole('button', { name: /Push A/ }));

    await expect
      .poll(() => screen.queryByRole('button', { name: /^Squat/ }) !== null)
      .toBe(true);
  });

  it('shows one entry per routine name', async () => {
    const user = userEvent.setup();
    await finishedSession('Push A');
    await finishedSession('Push A');
    await finishedSession('Push A');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);

    expect(picker.queryAllByRole('button', { name: /Push A/ })).toHaveLength(1);
  });

  it('offers nothing when no past session holds an exercise', async () => {
    const user = userEvent.setup();
    const { session } = await startSession();
    await endSession(session.id);

    render(<ActiveSessionScreen />);
    // No openPicker here: it waits on the list, and its absence is precisely
    // what is being asserted.
    await user.click(await screen.findByRole('button', { name: /Start from a past session/ }));

    expect(await screen.findByText(/Nothing to reuse yet/)).toBeDefined();
  });

  it('says what was left behind', async () => {
    const user = userEvent.setup();
    await finishedSession('Push A');
    await archiveExercise(pushUps.id);

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);
    await user.click(picker.getByRole('button', { name: /Push A/ }));

    expect(await screen.findByText(/archived since, and left out/, {}, { timeout: 5000 })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Squat/ })).toBeDefined();
    // The pattern excludes the banner, which names the skipped exercise too:
    // what has to be missing is the exercise *row*.
    expect(screen.queryByRole('button', { name: /^Push-ups(to do|[0-9]+ )/ })).toBeNull();
  });

  it('says nothing when everything could be carried over', async () => {
    const user = userEvent.setup();
    await finishedSession('Push A');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);
    await user.click(picker.getByRole('button', { name: /Push A/ }));

    await screen.findByRole('button', { name: /^Squat/ }, { timeout: 5000 });
    expect(screen.queryByText(/archived since/)).toBeNull();
  });
});

describe('after a set is logged', () => {
  /** A session of two exercises, the first already holding a set. */
  async function twoExercises() {
    const { session } = await startSession();
    const a = await addExerciseToSession(session.id, squat.id);
    const b = await addExerciseToSession(session.id, pushUps.id);
    await createSet({ sessionExerciseId: a.id, weightKg: 100, reps: 5, kind: 'work' });
    await createSet({ sessionExerciseId: b.id, reps: 12, kind: 'work' });
    return { session, a, b };
  }

  it('moves nothing: the single tap repeats', async () => {
    // The screen's central promise. It already held outside supersets; with
    // supersets gone, it holds everywhere.
    const user = userEvent.setup();
    await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await screen.findByRole('region', { name: /Log a set of Squat/ });

    await user.click(screen.getByRole('button', { name: /Save set/ }));

    await expect.poll(savedSets).toBe(3);
    expect(screen.getByRole('region', { name: /Log a set of Squat/ })).toBeDefined();
  });

  it('starts the rest', async () => {
    const user = userEvent.setup();
    await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await screen.findByRole('region', { name: /Log a set of Squat/ });
    await user.click(screen.getByRole('button', { name: /Save set/ }));

    expect(
      await screen.findByRole('region', { name: 'Rest timer' }, { timeout: 5000 }),
    ).toBeDefined();
  });
});

describe('an exercise counted per side', () => {
  it('says so on the entry field, where it decides the figure typed', async () => {
    // What using it taught: nothing told a unilateral exercise from any other,
    // where "10 reps" is twenty repetitions.
    const oneArm = await exerciseByKey('one arm dumbbell row');
    const { session } = await startSession();
    await addExerciseToSession(session.id, oneArm.id);

    render(<ActiveSessionScreen />);

    const panel = await screen.findByRole(
      'region',
      { name: /Log a set of One-arm dumbbell row/ },
      { timeout: 5000 },
    );
    expect(within(panel).getByLabelText('Reps / side')).toBeDefined();
  });

  it('says so on the set once it is logged', async () => {
    const oneArm = await exerciseByKey('one arm dumbbell row');
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, oneArm.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 22, reps: 10, kind: 'work' });

    render(<ActiveSessionScreen />);

    const tile = await screen.findByRole(
      'button',
      { name: /^Edit set 1/ },
      { timeout: 5000 },
    );
    // The mention closes the reading: "10 × 22/side", the way the set is said.
    expect(tile.getAttribute('aria-label')).toContain('10 × 22/side');
  });

  it('says nothing for a bilateral exercise', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });

    render(<ActiveSessionScreen />);

    const tile = await screen.findByRole('button', { name: /^Edit set 1/ }, { timeout: 5000 });
    expect(tile.getAttribute('aria-label')).not.toMatch(/side/);
  });
});
