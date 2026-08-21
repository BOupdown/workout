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

describe('le record personnel', () => {
  it('marque la série qui détient le record', async () => {
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

  it('déplace la marque quand une série plus lourde arrive', async () => {
    // Le point de la dérivation : rien n'est mémorisé au moment de l'écriture.
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

  it('ne marque aucun échauffement, si lourd soit-il', async () => {
    // Volontairement modeste. L'exclusion des échauffements est prouvée sur
    // `recordSet` dans progression.test.ts, seul endroit où elle est
    // atteignable : ici `recentSetsForExercise` les a déjà écartés avant que la
    // règle ne s'applique. Ce test constate le résultat, il ne prouve pas la
    // règle — vérifié par mutation, il ne tombe pas si la règle disparaît.
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

  it('ne marque rien quand aucune série de travail n existe', async () => {
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

describe('repartir d’une séance passée', () => {
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

  it('rouvre la disposition choisie, vide de séries', async () => {
    // Le moment où la promesse des deux taps ne tenait pas : démarrer imposait
    // de rajouter chaque exercice à la main.
    const user = userEvent.setup();
    await finishedSession('Push A');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);

    await user.click(picker.getByRole('button', { name: /Push A/ }));

    expect(await screen.findByRole('button', { name: /^Squat/ }, { timeout: 5000 })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Push-ups/ })).toBeDefined();
    // Une seule série en base : celle de la séance d'origine.
    await expect.poll(savedSets).toBe(1);
  });

  it('laisse choisir laquelle, pas seulement la dernière', async () => {
    // Le défaut de la première version : sur un split, la séance qu'on veut
    // reprendre n'est presque jamais celle qu'on vient de faire.
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

  it('ne montre qu’une entrée par nom de routine', async () => {
    const user = userEvent.setup();
    await finishedSession('Push A');
    await finishedSession('Push A');
    await finishedSession('Push A');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);

    expect(picker.queryAllByRole('button', { name: /Push A/ })).toHaveLength(1);
  });

  it('n’offre rien quand aucune séance passée ne porte d’exercice', async () => {
    const user = userEvent.setup();
    const { session } = await startSession();
    await endSession(session.id);

    render(<ActiveSessionScreen />);
    // Pas d openPicker ici : il attend la liste, et c est justement son absence
    // qu on verifie.
    await user.click(await screen.findByRole('button', { name: /Start from a past session/ }));

    expect(await screen.findByText(/Nothing to reuse yet/)).toBeDefined();
  });

  it('dit ce qui a été laissé de côté', async () => {
    const user = userEvent.setup();
    await finishedSession('Push A');
    await archiveExercise(pushUps.id);

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);
    await user.click(picker.getByRole('button', { name: /Push A/ }));

    expect(await screen.findByText(/archived since, and left out/, {}, { timeout: 5000 })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Squat/ })).toBeDefined();
    // Le motif exclut le bandeau, qui nomme lui aussi l exercice ecarte : ce
    // qui doit manquer, c est la *ligne* d exercice.
    expect(screen.queryByRole('button', { name: /^Push-ups(to do|[0-9]+ )/ })).toBeNull();
  });

  it('ne dit rien quand tout a pu être repris', async () => {
    const user = userEvent.setup();
    await finishedSession('Push A');

    render(<ActiveSessionScreen />);
    const picker = await openPicker(user);
    await user.click(picker.getByRole('button', { name: /Push A/ }));

    await screen.findByRole('button', { name: /^Squat/ }, { timeout: 5000 });
    expect(screen.queryByText(/archived since/)).toBeNull();
  });
});

describe('les supersets', () => {
  /** A session with two exercises, the first already carrying a set. */
  async function twoExercises() {
    const { session } = await startSession();
    const a = await addExerciseToSession(session.id, squat.id);
    const b = await addExerciseToSession(session.id, pushUps.id);
    await createSet({ sessionExerciseId: a.id, weightKg: 100, reps: 5, kind: 'work' });
    await createSet({ sessionExerciseId: b.id, reps: 12, kind: 'work' });
    return { session, a, b };
  }

  const link = () => screen.findByRole('button', { name: /Superset Squat with Push-ups/ });

  it('offre de lier deux exercices voisins', async () => {
    await twoExercises();
    render(<ActiveSessionScreen />);

    expect(await link()).toBeDefined();
  });

  it('n’offre rien après le dernier exercice', async () => {
    await twoExercises();
    render(<ActiveSessionScreen />);

    await link();
    expect(screen.queryByRole('button', { name: /Superset Push-ups with/ })).toBeNull();
  });

  it('lie puis délie', async () => {
    const user = userEvent.setup();
    const { a } = await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await link());
    await expect
      .poll(async () => (await db.sessionExercises.get(a.id))?.supersetGroup)
      .toBeTypeOf('number');

    await user.click(await screen.findByRole('button', { name: /Split Squat from Push-ups/ }));
    await expect
      .poll(async () => (await db.sessionExercises.get(a.id))?.supersetGroup)
      .toBeUndefined();
  });

  it('passe à l’exercice suivant après une série, dans un superset', async () => {
    // Le cœur du superset : on enchaîne sans repasser par la liste.
    const user = userEvent.setup();
    await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await link());
    await screen.findByRole('button', { name: /Split Squat from Push-ups/ });

    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await screen.findByRole('region', { name: /Log a set of Squat/ });

    await user.click(screen.getByRole('button', { name: /Save set/ }));

    expect(
      await screen.findByRole('region', { name: /Log a set of Push-ups/ }, { timeout: 5000 }),
    ).toBeDefined();
  });

  it('ne déplace rien hors superset : le tap unique répète', async () => {
    const user = userEvent.setup();
    await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await screen.findByRole('region', { name: /Log a set of Squat/ });

    await user.click(screen.getByRole('button', { name: /Save set/ }));

    await expect.poll(savedSets).toBe(3);
    expect(screen.getByRole('region', { name: /Log a set of Squat/ })).toBeDefined();
  });

  it('ne démarre pas de repos entre les membres du superset', async () => {
    const user = userEvent.setup();
    await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await link());
    await screen.findByRole('button', { name: /Split Squat from Push-ups/ });

    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await screen.findByRole('region', { name: /Log a set of Squat/ });
    await user.click(screen.getByRole('button', { name: /Save set/ }));

    await screen.findByRole('region', { name: /Log a set of Push-ups/ }, { timeout: 5000 });
    expect(window.localStorage.getItem('workout.rest-timer')).toBeNull();
  });

  it('démarre le repos après le dernier membre', async () => {
    const user = userEvent.setup();
    await twoExercises();
    render(<ActiveSessionScreen />);

    await user.click(await link());
    await screen.findByRole('button', { name: /Split Squat from Push-ups/ });

    await user.click(await screen.findByRole('button', { name: /^Push-ups/ }));
    await screen.findByRole('region', { name: /Log a set of Push-ups/ });
    await user.click(screen.getByRole('button', { name: /Save set/ }));

    expect(
      await screen.findByRole('region', { name: 'Rest timer' }, { timeout: 5000 }),
    ).toBeDefined();
  });
});
