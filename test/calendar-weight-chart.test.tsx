import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarView } from '../components/progression/calendar-view';
import { setBodyWeight } from '../lib/db/bodyweight';
import { resetDatabase } from './helpers';

/** Fixed so "this month" is not whatever day the suite happens to run. */
const TODAY = new Date('2026-08-22T09:00:00');

beforeEach(async () => {
  // The clock is stubbed, the timers are not. `vi.useFakeTimers` breaks Dexie
  // outright — transactions commit early — and the screen only ever asks for
  // the date through `Date.now`.
  vi.spyOn(Date, 'now').mockReturnValue(TODAY.getTime());
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const chart = () => screen.queryByRole('img', { name: /Bodyweight over/ });

describe('the bodyweight chart in the calendar', () => {
  it('plots the weigh-ins of the month on screen', async () => {
    await setBodyWeight('2026-08-01', 82);
    await setBodyWeight('2026-08-20', 79.5);

    render(<CalendarView />);

    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    expect(chart()?.getAttribute('aria-label')).toContain('from 82 to 79.5');
  });

  it('plots nothing from a single weigh-in', async () => {
    // One measurement is a number, not a trend — and the calendar cell is
    // already showing it.
    await setBodyWeight('2026-08-10', 80);

    render(<CalendarView />);

    await screen.findByText('August 2026');
    expect(chart()).toBeNull();
  });

  it('plots nothing for an empty month', async () => {
    render(<CalendarView />);

    await screen.findByText('August 2026');
    expect(chart()).toBeNull();
  });

  it('states the gap between the first and the last weigh-in', async () => {
    await setBodyWeight('2026-08-01', 82);
    await setBodyWeight('2026-08-20', 79.5);

    render(<CalendarView />);

    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    expect(await screen.findByText('-2.5 kg')).toBeDefined();
  });

  it('signs a gain, so it cannot read as a loss', async () => {
    await setBodyWeight('2026-08-01', 79);
    await setBodyWeight('2026-08-20', 81);

    render(<CalendarView />);

    expect(await screen.findByText('+2 kg')).toBeDefined();
  });

  it('leaves out the neighbouring days the grid still draws', async () => {
    // The grid for August 2026 opens on 27 July: those cells are tappable and
    // carry a weight, but a caption reading "August 2026" that plotted 27 July
    // would contradict itself.
    await setBodyWeight('2026-07-27', 90);
    await setBodyWeight('2026-08-05', 80);
    await setBodyWeight('2026-08-25', 79);

    render(<CalendarView />);

    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    const label = chart()?.getAttribute('aria-label');
    expect(label).toContain('2 readings');
    expect(label).toContain('from 80 to 79');
  });

  it('follows the month being looked at', async () => {
    const user = userEvent.setup();
    await setBodyWeight('2026-07-05', 85);
    await setBodyWeight('2026-07-28', 83);

    render(<CalendarView />);
    await screen.findByText('August 2026');
    expect(chart()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await screen.findByRole('heading', { name: 'July 2026' });
    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    expect(chart()?.getAttribute('aria-label')).toContain('from 85 to 83');
  });
});
