import { beforeEach, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { archiveExercise } from '../lib/db/exercises';
import { exportDatabase, importDatabase } from '../lib/db/backup';
import { deleteRoutine, saveRoutine, startSessionFromRoutine } from '../lib/db/routines';
import { listSessionExercises, startSession } from '../lib/db/sessions';
import type { Exercise, ExerciseTarget, RoutineExercise } from '../lib/db/types';
import { referenceExercises, resetDatabase } from './helpers';

const target: ExerciseTarget = { metric: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 120 };
const entry = (exercise: Exercise, id = 'position-1', goal: ExerciseTarget = target): RoutineExercise => ({ id, exerciseId: exercise.id, exerciseName: exercise.name, target: goal });
beforeEach(resetDatabase);

it('starts ordered blocks with independent targets and no fabricated sets, including a repeated exercise', async () => {
  const { squat, plank } = await referenceExercises();
  const exercises = [entry(squat), entry(plank, 'position-2', { metric: 'time', durationSec: 45, sets: 2, restSec: 60 }), entry(squat, 'position-3', { ...target, sets: 1 })];
  const routine = await saveRoutine({ title: '  Full body  ', exercises });
  const { session, firstBlockId } = await startSessionFromRoutine(routine.id);
  expect(session.title).toBe('Full body');
  const blocks = await listSessionExercises(session.id);
  expect(firstBlockId).toBe(blocks[0].id);
  expect(blocks.map((block) => [block.exerciseId, block.target])).toEqual(exercises.map((value) => [value.exerciseId, value.target]));
  expect(await db.sets.count()).toBe(0);
  await saveRoutine({ title: 'Changed', exercises: [entry(squat, 'new-position', { ...target, sets: 5 })] }, routine.id, routine.updatedAt);
  await deleteRoutine(routine.id);
  expect(await listSessionExercises(session.id)).toEqual(blocks);
  expect(await db.sessions.get(session.id)).toEqual(session);
});

it('keeps the active session when a routine is started twice', async () => {
  const { squat } = await referenceExercises();
  const routine = await saveRoutine({ title: 'Push', exercises: [entry(squat)] });
  const { session } = await startSession();
  await expect(startSessionFromRoutine(routine.id)).rejects.toThrow(/already in progress/);
  expect(await db.sessions.toArray()).toEqual([session]);
  expect(await db.sessionExercises.count()).toBe(0);
});

it.each(['archived', 'missing', 'changed metric'])('fails atomically if a later exercise is %s', async (state) => {
  const { squat, plank } = await referenceExercises();
  const routine = await saveRoutine({ title: 'Mixed', exercises: [entry(squat), entry(plank, 'second', { metric: 'time', sets: 2, restSec: 30, durationSec: 45 })] });
  if (state === 'archived') await archiveExercise(plank.id);
  if (state === 'missing') await db.exercises.delete(plank.id);
  if (state === 'changed metric') await db.exercises.update(plank.id, { metric: 'reps' });
  const pending = await db.syncOperations.toArray();
  await expect(startSessionFromRoutine(routine.id)).rejects.toThrow(/Edit the routine first/);
  expect(await db.sessions.count()).toBe(0);
  expect(await db.sessionExercises.count()).toBe(0);
  expect(await db.syncOperations.toArray()).toEqual(pending);
});

it('rejects stale editor saves and deleted routines', async () => {
  const { squat } = await referenceExercises();
  const input = { title: 'A', exercises: [entry(squat)] };
  const routine = await saveRoutine(input);
  await saveRoutine({ ...input, title: 'B' }, routine.id, routine.updatedAt);
  await expect(saveRoutine(input, routine.id, routine.updatedAt)).rejects.toThrow(/changed on another screen/);
  expect((await db.routines.get(routine.id))?.title).toBe('B');
  await deleteRoutine(routine.id);
  await expect(saveRoutine(input, routine.id)).rejects.toThrow(/deleted/);
});

it.each([
  { sets: 0 }, { sets: 1.5 }, { sets: 31 }, { restSec: 4 }, { restSec: 3601 },
  { repsMin: 13, repsMax: 12 }, { repsMin: 0 }, { repsMax: 1001 }, { durationSec: 30 },
])('rejects invalid targets without queuing them: %j', async (invalid) => {
  const { squat } = await referenceExercises();
  await expect(saveRoutine({ title: 'Invalid', exercises: [entry(squat, 'first', { ...target, ...invalid })] })).rejects.toThrow();
  expect(await db.routines.count()).toBe(0);
  expect(await db.syncOperations.where('table').equals('routines').count()).toBe(0);
});

it('round-trips routines and session targets through backup, preserving routines for old files', async () => {
  const { squat } = await referenceExercises();
  const routine = await saveRoutine({ title: 'A', exercises: [entry(squat)] });
  await startSessionFromRoutine(routine.id);
  const backup = await exportDatabase();
  await deleteRoutine(routine.id);
  await importDatabase(JSON.parse(JSON.stringify(backup)));
  expect(await db.routines.toArray()).toEqual([routine]);
  expect((await db.sessionExercises.toArray())[0].target).toEqual(target);
  delete backup.routines;
  await importDatabase(backup);
  expect(await db.routines.toArray()).toEqual([routine]);
});

it('rolls back an invalid backup without losing routines, sessions or pending writes', async () => {
  const { squat } = await referenceExercises();
  const routine = await saveRoutine({ title: 'A', exercises: [entry(squat)] });
  await startSessionFromRoutine(routine.id);
  const before = await exportDatabase();
  const pending = await db.syncOperations.toArray();
  const invalid = structuredClone(before);
  invalid.routines![0].exercises[0].target.sets = 0;
  await expect(importDatabase(invalid)).rejects.toThrow();
  expect((await exportDatabase()).routines).toEqual(before.routines);
  expect((await exportDatabase()).sessionExercises).toEqual(before.sessionExercises);
  expect(await db.syncOperations.toArray()).toEqual(pending);
});
