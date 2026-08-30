import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressionSheet } from '../components/progression/progression-sheet';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
  pushUps = await exerciseByKey('push ups');
});

/** One finished session holding the given sets, so it becomes a point. */
async function logSession(exercise: Exercise, sets: { weightKg?: number; reps: number }[]) {
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, exercise.id);
  for (const set of sets) {
    await createSet({ sessionExerciseId: block.id, ...set, kind: 'work' });
  }
  await endSession(session.id);
}

/**
 * The headline paragraph alone, as one string.
 *
 * Scoped to the sibling of the label rather than the whole section: read wider,
 * the assertion also sees the record line below and passes on *its* wording,
 * which is how the first version of this test survived a mutated headline.
 */
const headline = async () => {
  const label = await screen.findByText('Last session');
  return label.nextElementSibling?.textContent;
};

describe('ProgressionSheet', () => {
  it('reads reps before load, as everywhere else', async () => {
    // This headline is assembled by hand rather than through `describeSet`,
    // and no test covered it: it kept "100 kg × 5" above a list that had moved
    // to "5 × 100", with nothing to point it out.
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    // The parts are neighbouring <span>s, so no space separates them: what is
    // being asserted here is the order, not the spacing.
    expect(await headline()).toMatch(/^5 ×\s*100/);
  });

  it('keeps the load as the headline figure', async () => {
    // Reps lead, but the load is what this chart plots: it keeps the headline
    // size, and the reps stay an aside.
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Last session');

    expect(screen.getByText('5 ×').className).toContain('text-lg');
    expect(screen.getByText('100').closest('p')?.className).toContain('text-5xl');
  });

  it('writes the record in the same order', async () => {
    // Two orders on one screen is a screen that has to be read twice.
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);
    await logSession(squat, [{ weightKg: 90, reps: 8 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    const record = await screen.findByText('Record');
    expect(record.parentElement?.textContent).toContain('5 × 100');
  });

  it('invents no "×" when there is no load', async () => {
    // `reps` only accompanies the value when that value is a load. On a
    // bodyweight exercise the value *is* the reps, and "20 × 20" would be the
    // same figure written twice.
    await logSession(pushUps, [{ reps: 20 }]);

    render(<ProgressionSheet exercise={pushUps} onClose={vi.fn()} />);

    expect(await headline()).not.toContain('×');
  });

  it('details the sessions in that same order', async () => {
    await logSession(squat, [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 4 },
    ]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    expect(await screen.findByText('5 × 100')).toBeDefined();
    expect(screen.getByText('4 × 100')).toBeDefined();
  });
});

describe('the estimated 1RM view', () => {
  const estimateButton = () => screen.getByRole('button', { name: 'Est. 1RM' });

  it('is offered on a barbell exercise', async () => {
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Load' })).toBeDefined();
    expect(estimateButton()).toBeDefined();
  });

  it('is not offered where it would mean nothing', async () => {
    // Push-ups carry no load to scale, so there is no estimate to make and no
    // switch to offer.
    await logSession(pushUps, [{ reps: 20 }]);

    render(<ProgressionSheet exercise={pushUps} onClose={vi.fn()} />);
    await screen.findByText('Last session');

    expect(screen.queryByRole('button', { name: 'Est. 1RM' })).toBeNull();
  });

  it('replaces the headline with the estimate, and says what it came from', async () => {
    const user = userEvent.setup();
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Last session');

    await user.click(estimateButton());

    // "5 × 112.5" would read as five reps at 112.5 — the very set that was not
    // performed. The reps move to a line that can say what they are.
    expect(await headline()).toBe('112.5kg');
    expect(screen.getByText(/from 5 × 100 kg/)).toBeDefined();
  });

  it('names the model, every time it is on screen', async () => {
    const user = userEvent.setup();
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Last session');

    expect(screen.queryByText(/Brzycki/)).toBeNull();
    await user.click(estimateButton());
    expect(screen.getByText(/Brzycki/)).toBeDefined();
  });

  it('does not call an estimate a record', async () => {
    const user = userEvent.setup();
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);
    await logSession(squat, [{ weightKg: 90, reps: 8 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Record');

    await user.click(estimateButton());

    expect(screen.queryByText('Record')).toBeNull();
    // 8 × 90 estimates 111.7, just under the 112.5 of 5 × 100.
    expect(screen.getByText('Best estimate').parentElement?.textContent).toContain('112.5');
  });

  it('ranks the sessions on the estimate, not on the bar', async () => {
    // Ten at 60 then five at 65: heavier bar, weaker showing. The measured
    // headline rises to 65 and the estimated one drops to 73.1.
    const user = userEvent.setup();
    await logSession(squat, [{ weightKg: 60, reps: 10 }]);
    await logSession(squat, [{ weightKg: 65, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Last session');
    expect(await headline()).toBe('5 ×65kg');

    await user.click(estimateButton());
    expect(await headline()).toBe('73.1kg');
    expect(screen.getByText('Best estimate').parentElement?.textContent).toContain('80');
  });

  it('says why it is empty, and leaves the way back', async () => {
    // Sets exist, the formula simply will not read them. Saying "no work sets
    // yet" here would send someone to log a set they already logged — and the
    // switch has to survive the empty state it produced.
    const user = userEvent.setup();
    await logSession(squat, [{ weightKg: 40, reps: 20 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Last session');

    await user.click(estimateButton());

    expect(screen.getByText('Nothing to estimate from')).toBeDefined();
    expect(screen.queryByText('No work sets yet')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load' }));
    expect(await headline()).toBe('20 ×40kg');
  });
});
