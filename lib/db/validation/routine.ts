import { asRecord, isId, isTimestamp, type ValidationIssue, ValidationError } from './common';

export const ROUTINE_LIMITS = { title: 80, exercises: 40, sets: 30, reps: 1000, durationSec: 3600, restSec: 3600 } as const;
const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export function checkExerciseTarget(value: unknown): ValidationIssue[] {
  const target = asRecord(value);
  if (!target) return [{ field: 'target', code: 'invalid_target', message: 'Enter the planned sets, repetitions or duration, and rest.' }];
  const messages: string[] = [];
  if (!integer(target.sets, 1, ROUTINE_LIMITS.sets)) messages.push('Plan between 1 and 30 sets.');
  if (!integer(target.restSec, 5, ROUTINE_LIMITS.restSec)) messages.push('Rest must be between 5 and 3600 seconds.');
  if (target.metric === 'reps') {
    if (!integer(target.repsMin, 1, ROUTINE_LIMITS.reps) || !integer(target.repsMax, 1, ROUTINE_LIMITS.reps)
      || Number(target.repsMin) > Number(target.repsMax)) messages.push('Enter a repetition range between 1 and 1000, with minimum ≤ maximum.');
    if (target.durationSec !== undefined) messages.push('A repetition target cannot also contain a duration.');
  } else if (target.metric === 'time') {
    if (!integer(target.durationSec, 1, ROUTINE_LIMITS.durationSec)) messages.push('Duration must be between 1 and 3600 seconds.');
    if (target.repsMin !== undefined || target.repsMax !== undefined) messages.push('A timed target cannot also contain repetitions.');
  } else messages.push('Choose repetitions or time.');
  return messages.map((message) => ({ field: 'target', code: 'invalid_target', message }));
}

export function assertRoutineShape(value: unknown): void {
  const routine = asRecord(value);
  const issues: ValidationIssue[] = [];
  const issue = (message: string) => issues.push({ field: 'routine', code: 'invalid_routine', message });
  if (!routine) issue('A routine must be an object.');
  else {
    if (!isId(routine.id)) issue('A routine needs an identifier.');
    if (typeof routine.title !== 'string' || !routine.title.trim() || routine.title.length > ROUTINE_LIMITS.title) issue('Give the routine a name of 1–80 characters.');
    // Creation comes from the device clock, updates may come from the server.
    if (!isTimestamp(routine.createdAt) || !isTimestamp(routine.updatedAt)) issue('Invalid routine dates.');
    if (!Array.isArray(routine.exercises) || !routine.exercises.length || routine.exercises.length > ROUTINE_LIMITS.exercises) issue('Add between 1 and 40 exercises.');
    else {
      const ids = new Set<string>();
      for (const [index, value] of routine.exercises.entries()) {
        const entry = asRecord(value);
        if (!entry || !isId(entry.id) || !isId(entry.exerciseId) || typeof entry.exerciseName !== 'string' || !entry.exerciseName.trim()) { issue(`Exercise ${index + 1} is incomplete.`); continue; }
        if (ids.has(String(entry.id))) issue('Each position in a routine needs a different identifier.');
        ids.add(String(entry.id));
        issues.push(...checkExerciseTarget(entry.target).map((problem) => ({ ...problem, message: `${entry.exerciseName}: ${problem.message}` })));
      }
    }
  }
  if (issues.length) throw new ValidationError('routine', issues);
}
