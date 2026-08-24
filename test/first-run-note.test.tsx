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

describe('the first-run note', () => {
  it('shows up on a fresh device', async () => {
    render(<FirstRunNote />);

    expect(note()).not.toBeNull();
  });

  it('says where the data lives, not how the app works', async () => {
    // This is not a guided tour: one sentence, the one that changes what the
    // user believes before they have anything to lose.
    render(<FirstRunNote />);

    const panel = note()!.closest('div')!.parentElement!;
    expect(panel.textContent).toMatch(/kept on this phone alone/);
    expect(panel.textContent).toMatch(/no account and no server/);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('goes away once it has been read', async () => {
    const user = userEvent.setup();
    render(<FirstRunNote />);

    await user.click(screen.getByRole('button', { name: 'Got it' }));

    expect(note()).toBeNull();
  });

  it('never comes back', async () => {
    // The one real way to get this wrong: meeting it again on the fourth
    // session.
    const user = userEvent.setup();
    const first = render(<FirstRunNote />);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    first.unmount();

    render(<FirstRunNote />);

    expect(note()).toBeNull();
  });

  it('stays away on a device that was already told', async () => {
    window.localStorage.setItem('workout.told-where-data-lives', '1');

    render(<FirstRunNote />);

    expect(note()).toBeNull();
  });

  it('does not survive a reinstall that clears the storage', async () => {
    // `localStorage` goes with the site data: somebody starting from nothing
    // has to be told again, since their database is starting from nothing too.
    const user = userEvent.setup();
    const first = render(<FirstRunNote />);
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    first.unmount();

    window.localStorage.clear();
    render(<FirstRunNote />);

    expect(note()).not.toBeNull();
  });
});
