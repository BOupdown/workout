import { db } from './db';
import { newId } from './keys';
import { addExerciseToSession, getActiveSession, startSession } from './sessions';
import type { Routine, RoutineExercise } from './types';
import { assertExerciseSelectable, assertRoutineShape } from './validation';

export async function saveRoutine(input: { title: string; exercises: RoutineExercise[] }, id?: string, expectedUpdatedAt?: number): Promise<Routine> {
  return db.transaction('rw', [db.routines, db.exercises], async () => {
    const previous = id ? await db.routines.get(id) : undefined;
    if (id && !previous) throw new Error('This routine was deleted. Go back to your routines.');
    if (previous && expectedUpdatedAt !== undefined && previous.updatedAt !== expectedUpdatedAt) throw new Error('This routine changed on another screen. Reopen it before editing.');
    const now = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
    const routine: Routine = { id: previous?.id ?? newId(), title: input.title.trim(), exercises: structuredClone(input.exercises), createdAt: previous?.createdAt ?? now, updatedAt: now };
    assertRoutineShape(routine);
    for (const entry of routine.exercises) {
      const exercise = await db.exercises.get(entry.exerciseId);
      if (!exercise) throw new Error(`${entry.exerciseName} is no longer available. Remove or replace it.`);
      assertExerciseSelectable(exercise);
      if (exercise.metric !== entry.target.metric) throw new Error(`${exercise.name} now uses ${exercise.metric === 'time' ? 'time' : 'repetitions'}. Replace it to update its target.`);
      entry.exerciseName = exercise.name;
    }
    await db.routines.put(routine);
    return routine;
  });
}

export async function deleteRoutine(id: string): Promise<void> {
  await db.routines.delete(id);
}

export async function startSessionFromRoutine(id: string) {
  return db.transaction('rw', [db.routines, db.exercises, db.sessions, db.sessionExercises, db.sets], async () => {
    const routine = await db.routines.get(id);
    if (!routine) throw new Error('This routine is no longer available.');
    assertRoutineShape(routine);
    if (await getActiveSession()) throw new Error('A session is already in progress. Return to it before starting another.');
    // Check every exercise before starting: an unavailable exercise must never
    // silently shorten the plan or leave a partly created session behind.
    for (const entry of routine.exercises) {
      const exercise = await db.exercises.get(entry.exerciseId);
      if (!exercise || exercise.archivedAt !== undefined || exercise.metric !== entry.target.metric) throw new Error(`${entry.exerciseName} is no longer available with this target. Edit the routine first.`);
    }
    const { session } = await startSession({ title: routine.title });
    let firstBlockId: string | undefined;
    for (const entry of routine.exercises) {
      const block = await addExerciseToSession(session.id, entry.exerciseId);
      firstBlockId ??= block.id;
      await db.sessionExercises.update(block.id, { target: structuredClone(entry.target) });
    }
    return { session, firstBlockId };
  });
}
