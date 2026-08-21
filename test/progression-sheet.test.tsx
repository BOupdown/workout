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
  it('lit les répétitions avant la charge, comme partout ailleurs', async () => {
    // Cet en-tête est composé à la main, sans passer par `describeSet`, et
    // n'était couvert par aucun test : il a gardé « 100 kg × 5 » au-dessus
    // d'une liste passée à « 5 × 100 » sans que rien ne le signale.
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    // Les parties sont des <span> voisins, donc sans espace entre elles : ce
    // qui compte ici est l'ordre, pas la mise en forme.
    expect(await headline()).toMatch(/^5 ×\s*100/);
  });

  it('garde la charge en chiffre de tête', async () => {
    // Les répétitions passent devant, mais c'est la charge que ce graphe
    // trace : elle garde la taille du titre, les reps restent une mention.
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);
    await screen.findByText('Last session');

    expect(screen.getByText('5 ×').className).toContain('text-lg');
    expect(screen.getByText('100').closest('p')?.className).toContain('text-5xl');
  });

  it('écrit le record dans le même ordre', async () => {
    // Deux ordres sur le même écran, c'est un écran qu'on relit deux fois.
    await logSession(squat, [{ weightKg: 100, reps: 5 }]);
    await logSession(squat, [{ weightKg: 90, reps: 8 }]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    const record = await screen.findByText('Record');
    expect(record.parentElement?.textContent).toContain('5 × 100');
  });

  it('ne fabrique pas de « × » quand il n’y a pas de charge', async () => {
    // `reps` n'accompagne la valeur que lorsqu'elle est une charge. Sur un
    // exercice au poids du corps la valeur *est* les répétitions, et « 20 × 20 »
    // serait la même donnée écrite deux fois.
    await logSession(pushUps, [{ reps: 20 }]);

    render(<ProgressionSheet exercise={pushUps} onClose={vi.fn()} />);

    expect(await headline()).not.toContain('×');
  });

  it('détaille les séances dans le même ordre', async () => {
    await logSession(squat, [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 4 },
    ]);

    render(<ProgressionSheet exercise={squat} onClose={vi.fn()} />);

    expect(await screen.findByText('5 × 100')).toBeDefined();
    expect(screen.getByText('4 × 100')).toBeDefined();
  });
});
