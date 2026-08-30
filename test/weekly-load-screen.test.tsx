import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { WeeklyLoadScreen } from '../components/progression/weekly-load-screen';
import { shiftWeek, weekStartOf } from '../lib/calendar';
import { localMidnight, toLocalDate } from '../lib/db/keys';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;
let benchPress: Exercise;
let pushUps: Exercise;
let pullUp: Exercise;

/** The Monday of the week the screen opens on. */
let thisMonday: string;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat'); // quads, external
  benchPress = await exerciseByKey('bench press'); // chest, external
  pushUps = await exerciseByKey('push ups'); // chest, bodyweight
  pullUp = await exerciseByKey('pull up'); // back, weighted bodyweight
  thisMonday = weekStartOf(toLocalDate(Date.now()));
});

/**
 * A finished session `dayOffset` days after the Monday of `week`, at 18:00.
 *
 * Anchored on the week rather than on a fixed date: this screen opens on
 * whatever week it is run in, so a hard-coded August would only be tested in
 * August.
 */
async function logOn(
  week: string,
  dayOffset: number,
  exercise: Exercise,
  sets: { weightKg?: number; reps: number }[],
) {
  const day = new Date(localMidnight(week));
  day.setDate(day.getDate() + dayOffset);
  day.setHours(18, 0, 0, 0);

  const { session } = await startSession({ startedAt: day.getTime() });
  const block = await addExerciseToSession(session.id, exercise.id);
  for (const set of sets) {
    await createSet({ sessionExerciseId: block.id, ...set, kind: 'work' });
  }
  await endSession(session.id);
}

/** A muscle's whole row, as one string. */
const row = async (label: string) =>
  (await screen.findByText(label)).closest('li')?.textContent ?? '';

describe('WeeklyLoadScreen', () => {
  it('counts this week’s sets under each muscle', async () => {
    await logOn(thisMonday, 0, benchPress, [
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
    ]);
    await logOn(thisMonday, 2, squat, [{ weightKg: 100, reps: 5 }]);

    render(<WeeklyLoadScreen />);

    expect(await row('Chest')).toContain('2');
    expect(await row('Quads')).toContain('1');
    expect(await screen.findByText(/2 sessions/)).toBeDefined();
    expect(screen.getByText(/3 work sets/)).toBeDefined();
  });

  it('totals the tonnage of the loaded sets', async () => {
    // 60 × 10 twice, then 100 × 5: 1 700 kg.
    await logOn(thisMonday, 0, benchPress, [
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
    ]);
    await logOn(thisMonday, 2, squat, [{ weightKg: 100, reps: 5 }]);

    render(<WeeklyLoadScreen />);

    expect(await screen.findByText('1,700 kg')).toBeDefined();
  });

  it('counts a bodyweight set without inventing a tonnage for it', async () => {
    await logOn(thisMonday, 0, pushUps, [{ reps: 20 }]);
    await logOn(thisMonday, 1, pullUp, [{ weightKg: 10, reps: 8 }]);

    render(<WeeklyLoadScreen />);

    expect(await row('Chest')).toContain('1');
    expect(await row('Back')).toContain('1');
    // The belt on the pull-up is not the load that was moved, so neither set
    // adds anything to the week's volume.
    expect(screen.getByText('0 kg')).toBeDefined();
  });

  it('keeps a muscle that was trained last week and not this one', async () => {
    // The reading the screen exists for: legs disappeared, and a list built
    // from this week alone could not say so.
    await logOn(shiftWeek(thisMonday, -1), 0, squat, [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ]);
    await logOn(thisMonday, 0, benchPress, [{ weightKg: 60, reps: 10 }]);

    render(<WeeklyLoadScreen />);

    expect(await row('Quads')).toContain('−2');
  });

  it('compares each muscle with the week before', async () => {
    await logOn(shiftWeek(thisMonday, -1), 0, benchPress, [{ weightKg: 60, reps: 10 }]);
    await logOn(thisMonday, 0, benchPress, [
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
    ]);

    render(<WeeklyLoadScreen />);

    expect(await row('Chest')).toContain('+2');
  });

  it('walks back a week and reads that one instead', async () => {
    const user = userEvent.setup();
    await logOn(shiftWeek(thisMonday, -1), 0, squat, [{ weightKg: 100, reps: 5 }]);

    render(<WeeklyLoadScreen />);
    expect(await screen.findByText(/0 sessions/)).toBeDefined();

    await user.click(screen.getByLabelText('Previous week'));

    expect(await screen.findByText(/1 session/)).toBeDefined();
    expect(await row('Quads')).toContain('1');
  });

  it('will not walk into a week that has not happened', async () => {
    render(<WeeklyLoadScreen />);

    const forward = await screen.findByLabelText('Next week');
    expect(forward).toHaveProperty('disabled', true);

    // And releases as soon as there is somewhere to go back to.
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Previous week'));
    expect(screen.getByLabelText('Next week')).toHaveProperty('disabled', false);
  });

  it('says the week is empty rather than drawing an empty chart', async () => {
    render(<WeeklyLoadScreen />);

    expect(await screen.findByText(/Nothing logged this week/)).toBeDefined();
  });

  it('marks the week you are in', async () => {
    const user = userEvent.setup();
    render(<WeeklyLoadScreen />);

    expect(await screen.findByText('This week')).toBeDefined();

    await user.click(screen.getByLabelText('Previous week'));
    expect(screen.queryByText('This week')).toBeNull();
  });
});
