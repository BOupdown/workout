import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveSessionScreen } from '../components/session/active-session-screen';
import { PlateSheet } from '../components/session/plate-sheet';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import { exerciseByKey, resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  window.localStorage.clear();
});

/** The rack, as the settings would have left it. */
const stockRack = (plates: string) => window.localStorage.setItem('workout.plates.kg', plates);

/**
 * The line that reads one side out, matched **exactly**: "25 + 15" must not be
 * satisfied by "25 + 15 + 2.5", which is a different loading.
 */
const perSide = (reading: string) => screen.getByText(reading);

describe('PlateSheet', () => {
  it('shows what goes on one side', () => {
    render(<PlateSheet target={100} unit="kg" onClose={vi.fn()} />);

    // 100 on the default 20 bar: 40 a side.
    expect(perSide('25 + 15')).toBeDefined();
    expect(screen.getByText('target 100 kg')).toBeDefined();
  });

  it('reloads the bar when another one is picked', async () => {
    const user = userEvent.setup();
    render(<PlateSheet target={100} unit="kg" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '15' }));

    // 42.5 a side now, which is one 2.5 more than before.
    expect(perSide('25 + 15 + 2.5')).toBeDefined();
  });

  it('takes a bar none of the presets covers', async () => {
    // A trap bar is 25 kg and no preset offers it. The rest timer settles a
    // custom duration the same way, for the same reason: four buttons never
    // cover a room.
    const user = userEvent.setup();
    render(<PlateSheet target={100} unit="kg" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Another bar' }));

    const bar = screen.getByLabelText('Bar weight');
    await user.clear(bar);
    await user.type(bar, '25');
    await user.tab();

    expect(perSide('25 + 10 + 2.5')).toBeDefined();
  });

  it('only proposes plates the gym actually has', () => {
    // No 15s here, so 40 a side is not 25 + 15. A pass that took the heaviest
    // plate first would take the 25 and give up on the remaining 15.
    stockRack('25,20,10,5');

    render(<PlateSheet target={100} unit="kg" onClose={vi.fn()} />);

    expect(perSide('2 × 20')).toBeDefined();
  });

  it('names the gap when the load cannot be built', () => {
    // Without 1.25s, 92.5 is out of reach: 90 is the closest the rack gets.
    stockRack('25,20,15,10,5,2.5');

    render(<PlateSheet target={92.5} unit="kg" onClose={vi.fn()} />);

    const note = screen.getByRole('status').textContent ?? '';
    expect(note).toContain('90 kg');
    expect(note).toContain('2.5 kg short');
  });

  it('says nothing is left to load when the bar already weighs more', () => {
    render(<PlateSheet target={15} unit="kg" onClose={vi.fn()} />);

    expect(screen.getByText(/Lighter than the bar/)).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('waits for a load rather than guessing one', () => {
    render(<PlateSheet target={null} unit="kg" onClose={vi.fn()} />);

    expect(screen.getByText(/Type a load/)).toBeDefined();
  });

  it('points at the settings when the rack is empty', () => {
    stockRack('');

    render(<PlateSheet target={100} unit="kg" onClose={vi.fn()} />);

    expect(screen.getByText(/No plates are turned on/)).toBeDefined();
  });

  it('closes on Done', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PlateSheet target={100} unit="kg" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('reaching it from a session', () => {
  it('reads the load in the field, not the one it was opened on', async () => {
    const user = userEvent.setup();
    const squat = await exerciseByKey('squat');
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5, kind: 'work' });

    render(<ActiveSessionScreen />);

    await user.click(await screen.findByRole('button', { name: 'Plates for this load' }));
    expect(perSide('25 + 15')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    // The field is prefilled from the last set: one step up is 102.5.
    await user.click(screen.getByLabelText('Increase Load'));
    await user.click(screen.getByRole('button', { name: 'Plates for this load' }));

    // 41.25 a side.
    expect(perSide('25 + 15 + 1.25')).toBeDefined();
  });

  it('is not offered for a load no bar carries', async () => {
    // A weighted pull-up has a load field and no bar: the plates hang off a
    // belt, and halving them across two sleeves would be arithmetic about an
    // object that is not there.
    const pullUp = await exerciseByKey('pull up');
    const { session } = await startSession();
    await addExerciseToSession(session.id, pullUp.id);

    render(<ActiveSessionScreen />);

    expect(await screen.findByLabelText('Added')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Plates for this load' })).toBeNull();
  });
});
