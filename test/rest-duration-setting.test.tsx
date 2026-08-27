import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsScreen } from '../components/settings/settings-screen';
import { MAX_REST_SEC } from '../lib/rest-timer';
import { resetDatabase } from './helpers';

const DURATION_KEY = 'workout.rest-duration';

beforeEach(async () => {
  await resetDatabase();
  window.localStorage.clear();
});

const minutesField = () => screen.getByLabelText('Rest, minutes') as HTMLInputElement;
const secondsField = () => screen.getByLabelText('Rest, seconds') as HTMLInputElement;
const openCustom = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(await screen.findByRole('button', { name: 'Custom time' }, { timeout: 5000 }));

describe('a rest time the presets do not offer', () => {
  it('is typed in, and kept', async () => {
    // The whole point of the feedback: four buttons cannot cover every rest,
    // and 2:15 was simply unreachable.
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await openCustom(user);
    await user.clear(minutesField());
    await user.type(minutesField(), '2');
    await user.clear(secondsField());
    await user.type(secondsField(), '15');

    expect(window.localStorage.getItem(DURATION_KEY)).toBe('135');
  });

  it('opens on the value in force, so it is edited rather than retyped', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(DURATION_KEY, '120');
    render(<SettingsScreen />);

    await openCustom(user);

    expect(minutesField().value).toBe('2');
    expect(secondsField().value).toBe('00');
  });

  it('shows itself on the way back in, rather than a preset that is not set', async () => {
    // A custom rest must not read as unselected next to four presets, one of
    // which would otherwise be the only thing on screen.
    window.localStorage.setItem(DURATION_KEY, '135');
    render(<SettingsScreen />);

    expect(await screen.findByLabelText('Rest, minutes', {}, { timeout: 5000 })).toBeDefined();
    expect(minutesField().value).toBe('2');
    expect(secondsField().value).toBe('15');
  });

  it('gives way to a preset when one is tapped', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(DURATION_KEY, '135');
    render(<SettingsScreen />);

    await user.click(await screen.findByRole('button', { name: '3:00' }, { timeout: 5000 }));

    expect(window.localStorage.getItem(DURATION_KEY)).toBe('180');
    expect(screen.queryByLabelText('Rest, minutes')).toBeNull();
  });

  it('holds an entry that is never blurred', async () => {
    // A phone is as likely to be pocketed mid-field as tapped away from, so
    // every keystroke is committed rather than waiting for a blur that may
    // never come. Here: the minute left in place, the seconds retyped.
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await openCustom(user);
    await user.clear(secondsField());
    await user.type(secondsField(), '40');

    expect(window.localStorage.getItem(DURATION_KEY)).toBe('100');
  });

  it('pulls an entry out of bounds back into range, and says so on the field', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await openCustom(user);
    await user.clear(minutesField());
    await user.type(minutesField(), '90');
    await user.tab();

    expect(window.localStorage.getItem(DURATION_KEY)).toBe(String(MAX_REST_SEC));
    expect(minutesField().value).toBe('60');
    expect(secondsField().value).toBe('00');
  });

  it('never lands on a rest of zero, however the fields are emptied', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(DURATION_KEY, '135');
    render(<SettingsScreen />);

    // 2:15 with the minutes cleared is a readable 15 s and is kept as one;
    // clearing the seconds after that leaves nothing to read, and an empty
    // pair of fields is an edit in progress rather than a rest of zero.
    await user.clear(await screen.findByLabelText('Rest, minutes', {}, { timeout: 5000 }));
    await user.clear(secondsField());

    expect(window.localStorage.getItem(DURATION_KEY)).toBe('15');

    // And the fields say what is in force again the moment they are left.
    await user.tab();
    expect(minutesField().value).toBe('0');
    expect(secondsField().value).toBe('15');
  });
});
