import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { CalendarView } from '../components/progression/calendar-view';
import { toLocalDate } from '../lib/db/keys';
import { createTrainingBlock, listTrainingBlocks } from '../lib/db/training-blocks';
import { daysBetween } from '../lib/training-block';
import { resetDatabase } from './helpers';

const today = () => toLocalDate(Date.now());

/** `offset` days before today, as a local date. */
function daysAgo(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  return toLocalDate(date.getTime());
}

beforeEach(async () => {
  await resetDatabase();
  window.localStorage.clear();
});

const blockBar = () =>
  screen.findByRole('button', { name: 'Training blocks' }, { timeout: 5000 });

describe('la bande de bloc', () => {
  it('dit qu’il n’y en a aucun', async () => {
    render(<CalendarView />);

    await expect.poll(async () => (await blockBar()).textContent).toMatch(/No training block/);
  });

  it('annonce le bloc en cours et sa semaine', async () => {
    // Le point de la fonctionnalité : savoir où on en est sans compter de cases.
    await createTrainingBlock('Strength', daysAgo(9), daysAgo(-18));

    render(<CalendarView />);

    await expect.poll(async () => (await blockBar()).textContent).toMatch(/Strength/);
    expect((await blockBar()).textContent).toMatch(/week 2/);
  });

  it('démarre un bloc depuis la feuille', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    await user.click(await blockBar());

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    await user.type(within(sheet).getByLabelText('Block name'), 'Deload');
    await user.click(within(sheet).getByRole('button', { name: /Start this block/ }));

    await expect.poll(async () => (await listTrainingBlocks()).map((b) => b.label)).toEqual([
      'Deload',
    ]);
  });

  it('refuse de démarrer sans nom', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    await user.click(await blockBar());

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    const start = within(sheet).getByRole('button', { name: /Start this block/ });
    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it('supprime un bloc sans toucher aux autres', async () => {
    const user = userEvent.setup();
    await createTrainingBlock('Strength', daysAgo(30), daysAgo(11));
    await createTrainingBlock('Deload', daysAgo(3), daysAgo(-3));

    render(<CalendarView />);
    await user.click(await blockBar());

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    await user.click(within(sheet).getByRole('button', { name: 'Delete Deload' }));

    await expect.poll(async () => (await listTrainingBlocks()).map((b) => b.label)).toEqual([
      'Strength',
    ]);
  });

  it('refuse un bloc qui en chevauche un autre, et nomme le coupable', async () => {
    // On n'est pas dans deux cycles à la fois. Le message doit être actionnable.
    const user = userEvent.setup();
    await createTrainingBlock('Strength', today(), daysAgo(-27));

    render(<CalendarView />);
    await user.click(await blockBar());

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    await user.type(within(sheet).getByLabelText('Block name'), 'Peaking');
    await user.click(within(sheet).getByRole('button', { name: /Start this block/ }));

    expect(await within(sheet).findByRole('alert')).toBeDefined();
    expect(within(sheet).getByRole('alert').textContent).toMatch(/Strength/);
    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength']);
  });
});

describe('le compte des semaines', () => {
  it('démarre à la semaine 1 le premier jour', async () => {
    await createTrainingBlock('Strength', today(), daysAgo(-27));

    render(<CalendarView />);

    await expect.poll(async () => (await blockBar()).textContent).toMatch(/week 1/);
  });

  it('bascule en semaine 2 le huitième jour', async () => {
    // Sept jours écoulés font encore la semaine 1 ; c'est au huitième que ça
    // change, et c'est exactement la question « dois-je passer à autre chose ».
    await createTrainingBlock('Strength', daysAgo(7), daysAgo(-20));
    expect(daysBetween(daysAgo(7), today())).toBe(7);

    render(<CalendarView />);

    await expect.poll(async () => (await blockBar()).textContent).toMatch(/week 2/);
  });
});
