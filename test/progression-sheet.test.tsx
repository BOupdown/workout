import { render, screen } from '@testing-library/react';
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
