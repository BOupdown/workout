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

describe('le graphe de poids dans le calendrier', () => {
  it('trace les pesées du mois affiché', async () => {
    await setBodyWeight('2026-08-01', 82);
    await setBodyWeight('2026-08-20', 79.5);

    render(<CalendarView />);

    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    expect(chart()?.getAttribute('aria-label')).toContain('from 82 to 79.5');
  });

  it('ne trace rien sur une seule pesée', async () => {
    // Une mesure est un nombre, pas une tendance — et la case du calendrier
    // l'affiche déjà.
    await setBodyWeight('2026-08-10', 80);

    render(<CalendarView />);

    await screen.findByText('August 2026');
    expect(chart()).toBeNull();
  });

  it('ne trace rien sur un mois vide', async () => {
    render(<CalendarView />);

    await screen.findByText('August 2026');
    expect(chart()).toBeNull();
  });

  it('annonce l’écart entre la première et la dernière pesée', async () => {
    await setBodyWeight('2026-08-01', 82);
    await setBodyWeight('2026-08-20', 79.5);

    render(<CalendarView />);

    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    expect(await screen.findByText('-2.5 kg')).toBeDefined();
  });

  it('signe le gain, pour qu’il ne se lise pas comme une perte', async () => {
    await setBodyWeight('2026-08-01', 79);
    await setBodyWeight('2026-08-20', 81);

    render(<CalendarView />);

    expect(await screen.findByText('+2 kg')).toBeDefined();
  });

  it('ne compte pas les jours voisins que la grille affiche', async () => {
    // La grille d'août 2026 commence le 27 juillet : ces cases sont tapables et
    // portent un poids, mais une légende disant « August 2026 » qui tracerait
    // le 27 juillet serait fausse sur elle-même.
    await setBodyWeight('2026-07-27', 90);
    await setBodyWeight('2026-08-05', 80);
    await setBodyWeight('2026-08-25', 79);

    render(<CalendarView />);

    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    const label = chart()?.getAttribute('aria-label');
    expect(label).toContain('2 readings');
    expect(label).toContain('from 80 to 79');
  });

  it('suit le mois qu’on regarde', async () => {
    const user = userEvent.setup();
    await setBodyWeight('2026-07-05', 85);
    await setBodyWeight('2026-07-28', 83);

    render(<CalendarView />);
    await screen.findByText('August 2026');
    expect(chart()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    await screen.findByText('July 2026');
    await expect.poll(() => chart(), { timeout: 5000 }).not.toBeNull();
    expect(chart()?.getAttribute('aria-label')).toContain('from 85 to 83');
  });
});
