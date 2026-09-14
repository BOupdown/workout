import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { RoutinesPanel } from '../components/routines/routines-panel';
import { ActiveSessionScreen } from '../components/session/active-session-screen';
import { db } from '../lib/db/db';
import { saveRoutine, startSessionFromRoutine } from '../lib/db/routines';
import { createSet } from '../lib/db/sets';
import { referenceExercises, resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  localStorage.clear();
  // jsdom has no native modal implementation; real-browser QA checks focus.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

it('creates, orders, edits and deletes a routine through the editor', async () => {
  const user = userEvent.setup();
  render(<RoutinesPanel onClose={vi.fn()} onStart={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Create routine' }));
  await user.type(screen.getByLabelText('Routine name'), 'Full body');
  for (const name of ['Squat', 'Plank']) {
    await user.click(screen.getByRole('button', { name: 'Add exercise' }));
    await user.type(screen.getByRole('searchbox'), name);
    await user.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
  }
  await user.clear(screen.getByLabelText('Duration (seconds)'));
  await user.type(screen.getByLabelText('Duration (seconds)'), '45');
  await user.click(screen.getByRole('button', { name: 'Move Plank up' }));
  await user.click(screen.getByRole('button', { name: 'Save routine' }));
  await screen.findByRole('button', { name: 'Start Full body' });
  const routine = (await db.routines.toArray())[0];
  expect(routine.exercises.map((entry) => entry.exerciseName)).toEqual(['Plank', 'Squat']);
  expect(routine.exercises[0].target).toMatchObject({ metric: 'time', durationSec: 45 });
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  await user.clear(screen.getByLabelText('Routine name'));
  await user.type(screen.getByLabelText('Routine name'), 'Full body A');
  await user.click(screen.getByRole('button', { name: 'Save routine' }));
  await screen.findByRole('button', { name: 'Start Full body A' });
  await user.click(screen.getByRole('button', { name: 'Delete Full body A' }));
  expect(await db.routines.count()).toBe(1);
  await user.click(screen.getByRole('button', { name: 'Delete routine' }));
  await expect.poll(() => db.routines.count()).toBe(0);
});

it('keeps a draft until the user explicitly discards it', async () => {
  const user = userEvent.setup();
  render(<RoutinesPanel onClose={vi.fn()} onStart={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Create routine' }));
  await user.type(screen.getByLabelText('Routine name'), 'Draft');
  await user.click(screen.getByRole('button', { name: 'Back to routines' }));
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect((screen.getByLabelText('Routine name') as HTMLInputElement).value).toBe('Draft');
  await user.click(screen.getByRole('button', { name: 'Back to routines' }));
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.queryByLabelText('Routine name')).toBeNull();
  expect(await db.routines.count()).toBe(0);
});

it('starts from the home screen, prefills the target and uses its rest time', async () => {
  const { pushUps } = await referenceExercises();
  const routine = await saveRoutine({ title: 'Push', exercises: [{ id: 'first', exerciseId: pushUps.id, exerciseName: pushUps.name, target: { metric: 'reps', sets: 3, repsMin: 10, repsMax: 15, restSec: 150 } }] });
  const user = userEvent.setup();
  render(<ActiveSessionScreen />);
  await user.click(await screen.findByRole('button', { name: /Your routines/ }));
  await user.click(await screen.findByRole('button', { name: 'Start Push' }));
  const panel = await screen.findByRole('region', { name: `Log a set of ${pushUps.name}` });
  expect((within(panel).getByLabelText('Reps') as HTMLInputElement).value).toBe('10');
  expect(within(panel).getByText('0/3 work sets')).toBeTruthy();
  expect(await db.sets.count()).toBe(0);
  await user.click(within(panel).getByRole('button', { name: /Save set/ }));
  await expect.poll(() => db.sets.count()).toBe(1);
  expect(JSON.parse(localStorage.getItem('workout.rest-timer')!).durationSec).toBe(150);
  expect(await db.routines.get(routine.id)).toBeTruthy();
});

it('counts work sets separately from warmups and keeps actual history as the prefill', async () => {
  const { squat } = await referenceExercises();
  const routine = await saveRoutine({ title: 'Squat day', exercises: [{ id: 'first', exerciseId: squat.id, exerciseName: squat.name, target: { metric: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 120 } }] });
  const { firstBlockId } = await startSessionFromRoutine(routine.id);
  await createSet({ sessionExerciseId: firstBlockId!, kind: 'warmup', weightKg: 20, reps: 5 });
  await createSet({ sessionExerciseId: firstBlockId!, kind: 'work', weightKg: 60, reps: 9 });
  render(<ActiveSessionScreen />);
  const panel = await screen.findByRole('region', { name: 'Log a set of Squat' });
  expect(within(panel).getByText('1/3 work sets')).toBeTruthy();
  expect((within(panel).getByLabelText('Reps') as HTMLInputElement).value).toBe('9');
});
