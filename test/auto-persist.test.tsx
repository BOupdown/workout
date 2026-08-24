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

/*
 * A generous budget, for a structural reason rather than a slow machine:
 * `freshScreen` calls `vi.resetModules()`, so every test re-evaluates the whole
 * import graph of the screen — Dexie, the icons, every sheet. That is ~875 ms
 * per test in isolation, and a good deal more when the suite runs in parallel.
 * The default 5 s was enough until the graph grew.
 */
describe('persistence the app asks for', { timeout: 30_000 }, () => {
  it('asks for persistence as soon as a session starts', async () => {
    // The point of this whole change: left behind a button in the settings,
    // the request was never made, which amounts to having no
    // protection.
    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));

    // An explicit budget: these tests re-import the module from cold, and under
    // parallel load the default second is not always enough. What changes is
    // the deadline, not what is being asserted.
    await expect.poll(() => persist.mock.calls.length, { timeout: 5000 }).toBe(1);
  });

  it('does not ask again when it has already been granted', async () => {
    persisted.mockResolvedValue(true);

    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));

    await expect.poll(() => persisted.mock.calls.length).toBeGreaterThan(0);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks once per launch, whatever happens afterwards', async () => {
    // A request on every set would be wasted work, and on the browsers that
    // show a prompt, harassment.
    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));
    // An explicit budget: these tests re-import the module from cold, and under
    // parallel load the default second is not always enough. What changes is
    // the deadline, not what is being asserted.
    await expect.poll(() => persist.mock.calls.length, { timeout: 5000 }).toBe(1);

    await user.click(await screen.findByRole('button', { name: /Add exercise/ }));
    await user.click(await screen.findByRole('button', { name: /^Squat/ }));
    await user.click(await screen.findByRole('button', { name: /Save set/ }, { timeout: 5000 }));

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('breaks nothing where the API does not exist', async () => {
    Reflect.deleteProperty(navigator, 'storage');

    const user = userEvent.setup();
    const ActiveSessionScreen = await freshScreen();

    render(<ActiveSessionScreen />);
    await user.click(await screen.findByRole('button', { name: 'Start a session' }));

    // The session starts all the same: persistence is a bonus, not a
    // prerequisite.
    expect(await screen.findByRole('button', { name: /Add exercise/ })).toBeDefined();
  });
});
