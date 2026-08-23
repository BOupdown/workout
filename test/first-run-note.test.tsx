import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { FirstRunNote } from '../components/onboarding/first-run-note';
import { resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  window.localStorage.clear();
});

const note = () => screen.queryByRole('heading', { name: 'Your training stays here' });

describe('la note du premier lancement', () => {
  it('se montre sur un appareil neuf', async () => {
    render(<FirstRunNote />);

    expect(note()).not.toBeNull();
  });

  it('dit où vivent les données, pas comment marche l’app', async () => {
    // Ce n'est pas une visite guidée : une phrase, celle qui change ce que
    // l'utilisateur croit avant d'avoir quoi que ce soit à perdre.
    render(<FirstRunNote />);

    const panel = note()!.closest('div')!.parentElement!;
    expect(panel.textContent).toMatch(/kept on this phone alone/);
    expect(panel.textContent).toMatch(/no account and no server/);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('disparaît quand on l’a lue', async () => {
    const user = userEvent.setup();
    render(<FirstRunNote />);

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(note()).toBeNull();
  });

  it('ne revient jamais', async () => {
    // Le seul vrai défaut possible : la revoir à la quatrième séance.
    const user = userEvent.setup();
    const first = render(<FirstRunNote />);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    first.unmount();

    render(<FirstRunNote />);

    expect(note()).toBeNull();
  });

  it('ne se montre pas sur un appareil déjà prévenu', async () => {
    window.localStorage.setItem('workout.told-where-data-lives', '1');

    render(<FirstRunNote />);

    expect(note()).toBeNull();
  });

  it('ne survit pas à une réinstallation qui efface le stockage', async () => {
    // `localStorage` part avec les données du site : quelqu'un qui repart de
    // zéro doit être prévenu de nouveau, puisque sa base l'est aussi.
    const user = userEvent.setup();
    const first = render(<FirstRunNote />);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    first.unmount();

    window.localStorage.clear();
    render(<FirstRunNote />);

    expect(note()).not.toBeNull();
  });
});
