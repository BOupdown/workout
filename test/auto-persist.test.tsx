import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from './helpers';

/**
 * The module keeps a "already asked this launch" flag, so each test needs a
 * fresh copy of it — and of the screen that imports it.
 */
async function freshScreen() {
  vi.resetModules();
  const { ActiveSessionScreen } = await import('../components/session/active-session-screen');
  return ActiveSessionScreen;
}

let persist: ReturnType<typeof vi.fn>;
let persisted: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetDatabase();
  window.localStorage.clear();

  persist = vi.fn().mockResolvedValue(true);
  persisted = vi.fn().mockResolvedValue(false);

  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist, persisted, estimate: vi.fn().mockResolvedValue({ usage: 0 }) },
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

describe('persistance demandée par l’app', () => {
  it('demande la persistance dès qu’une séance démarre', async () => {
    // Le point de tout ce changement : laissée derrière un bouton des réglages,
    // la demande n'était jamais faite, ce qui revient à n'avoir aucune
    // protection.
    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));

    // Budget explicite : ces tests réimportent le module à chaud, et sous charge
    // parallèle la seconde par défaut ne suffit pas toujours. C'est le délai qui
    // change, pas ce qui est vérifié.
    await expect.poll(() => persist.mock.calls.length, { timeout: 5000 }).toBe(1);
  });

  it('ne redemande pas quand c’est déjà accordé', async () => {
    persisted.mockResolvedValue(true);

    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));

    await expect.poll(() => persisted.mock.calls.length).toBeGreaterThan(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it('ne demande qu’une fois par lancement, quoi qu’il arrive ensuite', async () => {
    // Une demande à chaque série serait un travail inutile, et sur les
    // navigateurs qui affichent une invite, un harcèlement.
    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    // Budget explicite : ces tests réimportent le module à chaud, et sous charge
    // parallèle la seconde par défaut ne suffit pas toujours. C'est le délai qui
    // change, pas ce qui est vérifié.
    await expect.poll(() => persist.mock.calls.length, { timeout: 5000 }).toBe(1);

    await user.click(await screen.findByRole('button', { name: /Add exercise/ }));
    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await user.click(await screen.findByRole('button', { name: /Save set/ }, { timeout: 5000 }));

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('ne casse rien là où l’API n’existe pas', async () => {
    Reflect.deleteProperty(navigator, 'storage');

    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));

    // La séance démarre quand même : la persistance est un bonus, pas un prérequis.
    expect(await screen.findByRole('button', { name: /Add exercise/ })).toBeDefined();
  });
});
