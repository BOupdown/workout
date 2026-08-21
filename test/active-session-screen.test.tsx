import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActiveSessionScreen } from '../components/session/active-session-screen';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import { db } from '../lib/db/db';
import type { Exercise } from '../lib/db/types';
import { exerciseByKey, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  squat = await exerciseByKey('squat');
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

describe('la promesse des deux taps', () => {
  it('enregistre une série en deux taps quand l’exercice est déjà dans la séance', async () => {
    // C'est la thèse de l'app, et jusqu'ici aucun test ne la tenait : un tap sur
    // la ligne (qui l'active *et* recharge le brouillon), un tap sur Save.
    const user = userEvent.setup();
    await sessionWithHistory();

    render(<ActiveSessionScreen />);

    const row = await screen.findByRole('button', { name: /^Squat/ });
    await user.click(row);

    const save = await screen.findByRole('button', { name: /Save set/ });
    await user.click(save);

    await expect.poll(savedSets).toBe(2);
  });

  it('répète une série à l’identique en un seul tap', async () => {
    // Le brouillon n'est pas vidé après un enregistrement : la même charge et
    // les mêmes reps repartent sans rien retaper.
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

  it('pré-remplit la saisie avec la série précédente', async () => {
    await sessionWithHistory();
    render(<ActiveSessionScreen />);

    const panel = await screen.findByRole('region', { name: /Log a set of Squat/ });
    const load = within(panel).getByLabelText('Load') as HTMLInputElement;
    const reps = within(panel).getByLabelText('Reps') as HTMLInputElement;

    expect(load.value).toBe('100');
    expect(reps.value).toBe('5');
  });
});

describe('le minuteur de repos et la zone du pouce', () => {
  it('démarre un repos dès qu’une série est écrite', async () => {
    const user = userEvent.setup();
    await sessionWithHistory();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: /Save set/ }));

    expect(await screen.findByRole('region', { name: 'Rest timer' })).toBeDefined();
    expect(window.localStorage.getItem('workout.rest-timer')).toContain('durationSec');
  });

  it('n’insère jamais la barre entre la liste et le panneau de saisie', async () => {
    // L'invariant qui protège le tap unique : la barre prend sa place *au-dessus*
    // de la liste, jamais entre la liste et le panneau. Sans ça, elle pousserait
    // « Save set » vers le haut à l'instant même où la série part, et déplacerait
    // la cible sous le pouce. Vérifié sur l'ordre du DOM, faute de mise en page
    // sous jsdom.
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

  it('ne laisse aucun repos courir après la fin de la séance', async () => {
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
