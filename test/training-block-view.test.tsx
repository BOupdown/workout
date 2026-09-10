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

/** The panel above the grid. It holds exactly one button, whatever its label. */
const blockPanel = () =>
  screen.findByRole('region', { name: 'Training block' }, { timeout: 5000 });

const openBlocks = async (user: ReturnType<typeof userEvent.setup>) => {
  const panel = await blockPanel();
  await user.click(within(panel).getByRole('button'));
};

describe('the block bar', () => {
  it('offers plainly to add one when there is none', async () => {
    // The flaw that was reported: a thin row holding a "+" does not say what it
    // is, and a control nobody recognises is a control nobody uses.
    render(<CalendarView />);

    const panel = await blockPanel();
    expect(within(panel).getByRole('button').textContent).toMatch(/Add a training block/);
  });

  it('announces the running block and its week', async () => {
    // The point of the feature: knowing where you stand without counting
    // squares.
    await createTrainingBlock('Strength', daysAgo(9), daysAgo(-18));

    render(<CalendarView />);

    await expect.poll(async () => (await blockPanel()).textContent).toMatch(/Strength/);
    expect((await blockPanel()).textContent).toMatch(/week 2/);
  });

  it('starts a block from the sheet', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    await openBlocks(user);

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    await user.type(within(sheet).getByLabelText('Block name'), 'Deload');
    await user.click(within(sheet).getByRole('button', { name: /Start this block/ }));

    await expect.poll(async () => (await listTrainingBlocks()).map((b) => b.label)).toEqual([
      'Deload',
    ]);
  });

  it('refuses to start without a name', async () => {
    const user = userEvent.setup();
    render(<CalendarView />);

    await openBlocks(user);

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    const start = within(sheet).getByRole('button', { name: /Start this block/ });
    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it('deletes a block without touching the others', async () => {
    const user = userEvent.setup();
    await createTrainingBlock('Strength', daysAgo(30), daysAgo(11));
    await createTrainingBlock('Deload', daysAgo(3), daysAgo(-3));

    render(<CalendarView />);
    await openBlocks(user);

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    await user.click(within(sheet).getByRole('button', { name: 'Delete Deload' }));

    await expect.poll(async () => (await listTrainingBlocks()).map((b) => b.label)).toEqual([
      'Strength',
    ]);
  });

  it('refuses a block that overlaps another, and names the culprit', async () => {
    // You are not in two cycles at once. The message has to be actionable.
    const user = userEvent.setup();
    await createTrainingBlock('Strength', today(), daysAgo(-27));

    render(<CalendarView />);
    await openBlocks(user);

    const sheet = await screen.findByRole('region', { name: 'Training blocks' });
    await user.type(within(sheet).getByLabelText('Block name'), 'Peaking');
    await user.click(within(sheet).getByRole('button', { name: /Start this block/ }));

    expect(await within(sheet).findByRole('alert')).toBeDefined();
    expect(within(sheet).getByRole('alert').textContent).toMatch(/Strength/);
    expect((await listTrainingBlocks()).map((b) => b.label)).toEqual(['Strength']);
  });
});

describe('counting the weeks', () => {
  it('starts at week 1 on the first day', async () => {
    await createTrainingBlock('Strength', today(), daysAgo(-27));

    render(<CalendarView />);

    await expect.poll(async () => (await blockPanel()).textContent).toMatch(/week 1/);
  });

  it('tips into week 2 on the eighth day', async () => {
    // Seven days gone is still week 1; the eighth is where it changes, and that
    // is exactly the "should I move on" question.
    await createTrainingBlock('Strength', daysAgo(7), daysAgo(-20));
    expect(daysBetween(daysAgo(7), today())).toBe(7);

    render(<CalendarView />);

    await expect.poll(async () => (await blockPanel()).textContent).toMatch(/week 2/);
  });
});

describe('blocks on the grid', () => {
  const cellFor = (date: string) =>
    screen.getByRole('button', { name: new RegExp(`^${date}`) }).getAttribute('aria-label');

  /** The grid deliberately shows one month, so inspect a past date in its own
   * month rather than assuming every `daysAgo()` value is a leading day. */
  const showMonthOf = async (user: ReturnType<typeof userEvent.setup>, date: string) => {
    const targetMonth = date.slice(0, 7);
    const currentMonth = today().slice(0, 7);

    if (targetMonth < currentMonth) {
      await user.click(screen.getByRole('button', { name: 'Previous month' }));
      await screen.findByRole('button', { name: new RegExp(`^${date}`) });
      return -1;
    } else if (targetMonth > currentMonth) {
      await user.click(screen.getByRole('button', { name: 'Next month' }));
      await screen.findByRole('button', { name: new RegExp(`^${date}`) });
      return 1;
    }

    await screen.findByRole('button', { name: new RegExp(`^${date}`) });
    return 0;
  };

  it('marks a block that is already over too', async () => {
    // The flaw that was reported: a past block drew as an empty day, so the
    // shape of the month could not be read — which is the whole reason blocks
    // appear on a calendar.
    await createTrainingBlock('Peaking', daysAgo(20), daysAgo(11));
    await createTrainingBlock('Strength', daysAgo(10), daysAgo(-17));

    const user = userEvent.setup();
    render(<CalendarView />);
    await screen.findByRole('button', { name: new RegExp(`^${today()}`) }, { timeout: 5000 });

    const monthOffset = await showMonthOf(user, daysAgo(15));
    await expect.poll(() => cellFor(daysAgo(15))).toMatch(/Peaking/);
    if (monthOffset < 0) await user.click(screen.getByRole('button', { name: 'Next month' }));
    await screen.findByRole('button', { name: new RegExp(`^${today()}`) });
    expect(cellFor(today())).toMatch(/Strength/);
  });

  it('leaves a day outside every block bare', async () => {
    await createTrainingBlock('Strength', daysAgo(10), daysAgo(-17));

    const user = userEvent.setup();
    render(<CalendarView />);
    await screen.findByRole('button', { name: new RegExp(`^${today()}`) }, { timeout: 5000 });

    // The running block acts as the witness that the queries have answered.
    await expect.poll(() => cellFor(today())).toMatch(/Strength/);
    await showMonthOf(user, daysAgo(20));
    expect(cellFor(daysAgo(20))).not.toMatch(/Strength/);
  });

  it('names the block each day belongs to', async () => {
    // What the screen reader gets in place of the tint.
    await createTrainingBlock('Deload', daysAgo(3), daysAgo(-3));

    render(<CalendarView />);
    await screen.findByRole('button', { name: new RegExp(`^${today()}`) }, { timeout: 5000 });

    await expect.poll(() => cellFor(today())).toMatch(/Deload/);
  });
});
