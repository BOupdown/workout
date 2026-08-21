/**
 * Write layer for sessions and blocks (`SessionExercise`).
 *
 * Same doctrine as `./sets`:
 *   1. **Derive rather than validate** — `id`, `date`, `order` and `createdAt`
 *      appear in no input type.
 *   2. **Validate what remains**, inside the transaction, against the parent
 *      entities, which the synchronous Dexie hooks cannot do.
 */

import { db } from './db';
import { toggleJoinWithNext } from '../superset';
import { localMidnight, newId, toLocalDate } from './keys';
import type { Id, LocalDate, Session, SessionExercise, Timestamp } from './types';
import { assertExerciseSelectable } from './validation';

/** See `MIN_NUMBER_KEY` in `./sets` — same bounds, same reason. */
const MIN_NUMBER_KEY = -Infinity;
const MAX_NUMBER_KEY = Infinity;

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when removing a block that already holds sets without passing `force`.
 * Carries `setCount` so the UI can ask for a numbered confirmation ("Remove
 * Squat and its 4 sets?") rather than a vague warning.
 */
export class SessionExerciseNotEmptyError extends Error {
  readonly sessionExerciseId: Id;
  readonly setCount: number;

  constructor(sessionExerciseId: Id, setCount: number) {
    super(
      `This exercise holds ${setCount} set${setCount > 1 ? 's' : ''}: ` +
        'pass `force: true` to remove it along with them.',
    );
    this.name = 'SessionExerciseNotEmptyError';
    this.sessionExerciseId = sessionExerciseId;
    this.setCount = setCount;
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface NewSessionInput {
  title?: string;
  bodyweightKg?: number;
  notes?: string;
  /** For logging a past session. Defaults to now. */
  startedAt?: Timestamp;
}

export interface StartSessionResult {
  session: Session;
  /**
   * A session left open and closed automatically to make room. Worth surfacing
   * to the user: they did not ask for it.
   */
  autoClosed?: Session;
}

/**
 * The session in progress, if there is one. Modifies **nothing**: reopening the
 * app twenty minutes later must resume the session, not close it.
 *
 * Walks backwards from the most recent; under the "at most one open session"
 * invariant held by `startSession`, the answer comes on the first try.
 */
export async function getActiveSession(): Promise<Session | undefined> {
  return db.sessions
    .orderBy('startedAt')
    .reverse()
    .filter((session) => session.endedAt === undefined)
    .first();
}

/**
 * Closes a session at the instant of its **last logged set**, not at "now":
 * without that, a session forgotten a week ago would report a seven-day
 * duration. With no sets at all, it falls back to `startedAt`.
 */
async function closeAtLastLoggedSet(session: Session): Promise<Session> {
  const sets = await db.sets.where('sessionId').equals(session.id).toArray();
  const lastLoggedAt = sets.reduce((latest, set) => Math.max(latest, set.loggedAt), 0);

  const endedAt = Math.max(session.startedAt, lastLoggedAt);
  await db.sessions.update(session.id, { endedAt });
  return { ...session, endedAt };
}

/**
 * Opens a session.
 *
 * If a previous session was left open — the common case: you pocket your phone
 * without tapping "Finish" — it is **closed automatically** rather than
 * blocking the user in the gym with an error. The session thus closed is
 * returned in `autoClosed` so the UI can say so.
 */
export async function startSession(input: NewSessionInput = {}): Promise<StartSessionResult> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    // A full scan rather than reading only the most recent session: this is what
    // guarantees the "at most one open" invariant even if a stray row slipped
    // in. The table stays small (one row per session); were it to grow, an
    // indexed `status` field would take over.
    const stillOpen = await db.sessions
      .filter((session) => session.endedAt === undefined)
      .toArray();

    let autoClosed: Session | undefined;
    for (const session of stillOpen) {
      autoClosed = await closeAtLastLoggedSet(session);
    }

    const startedAt = input.startedAt ?? Date.now();
    const session: Session = {
      id: newId(),
      startedAt,
      date: toLocalDate(startedAt),
      createdAt: Date.now(),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.bodyweightKg !== undefined ? { bodyweightKg: input.bodyweightKg } : {}),
    };

    await db.sessions.add(session);
    return autoClosed ? { session, autoClosed } : { session };
  });
}

export interface StartFromSessionResult extends StartSessionResult {
  /** Exercises carried over, in their original order. */
  copied: number;
  /**
   * Names of exercises left behind because they have since been archived.
   * Returned rather than dropped quietly: the new session is visibly shorter
   * than the one it came from, and the screen has to be able to say why.
   */
  skipped: string[];
}

/**
 * Starts a session laid out like an earlier one.
 *
 * Only the exercises are carried, never the sets: this is a plan, not a copy.
 * The notes stay behind too — "bench set too high" was true of that day, and
 * re-attaching it to a session that has not happened yet would be a lie.
 *
 * Everything runs in one transaction, so a session is never left half built:
 * either it opens with its whole layout, or nothing is written.
 */
export async function startSessionFrom(sourceId: Id): Promise<StartFromSessionResult> {
  return db.transaction(
    'rw',
    db.sessions,
    db.sets,
    db.sessionExercises,
    db.exercises,
    async () => {
      const source = await db.sessions.get(sourceId);
      if (!source) throw new Error(`Session not found: ${sourceId}`);

      const blocks = await listSessionExercises(sourceId);
      const started = await startSession();

      const skipped: string[] = [];
      let copied = 0;

      for (const block of blocks) {
        const exercise = await db.exercises.get(block.exerciseId);
        if (!exercise) continue;

        // Archived on purpose since that session: putting it back would undo a
        // decision the user made, and `addExerciseToSession` refuses it anyway.
        if (exercise.archivedAt !== undefined) {
          skipped.push(exercise.name);
          continue;
        }

        await addExerciseToSession(started.session.id, exercise.id);
        copied += 1;
      }

      return { ...started, copied, skipped };
    },
  );
}

/**
 * Closes a session. Idempotent: closing an already-finished session returns it
 * unchanged, so a double tap on "Finish" produces no error.
 */
export async function endSession(id: Id, endedAt: Timestamp = Date.now()): Promise<Session> {
  return db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);
    if (session.endedAt !== undefined) return session;

    // `endedAt >= startedAt` is checked by the structural hook.
    await db.sessions.update(id, { endedAt });
    return { ...session, endedAt };
  });
}

/**
 * Changes a session's day and **propagates `performedAt` to all of its sets** —
 * the denormalisation that makes per-exercise history fast is also the one that
 * can drift. This is the only sanctioned way to change a session's date.
 *
 * The time of day is preserved and `endedAt` shifts by the same amount: the real
 * case is "I logged this yesterday, not today", not "move it to midnight".
 */
export async function updateSessionDate(id: Id, date: LocalDate): Promise<Session> {
  return db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    // The time of day is taken from `startedAt` itself rather than from
    // `session.date`: it stays correct even if the two diverged after a
    // timezone change.
    const previous = new Date(session.startedAt);
    const target = new Date(localMidnight(date));
    target.setHours(
      previous.getHours(),
      previous.getMinutes(),
      previous.getSeconds(),
      previous.getMilliseconds(),
    );

    const startedAt = target.getTime();
    const shift = startedAt - session.startedAt;
    const endedAt = session.endedAt !== undefined ? session.endedAt + shift : undefined;

    await db.sessions.update(id, {
      startedAt,
      date,
      ...(endedAt !== undefined ? { endedAt } : {}),
    });

    await db.sets.where('sessionId').equals(id).modify({ performedAt: startedAt });

    return { ...session, startedAt, date, ...(endedAt !== undefined ? { endedAt } : {}) };
  });
}

/**
 * The free text of a session: what it is called, and anything worth a sentence.
 *
 * Deliberately **not** a general-purpose session patch. The date and the
 * bodyweight already have their own functions because each carries a
 * consequence — `performedAt` on every set of the session, progression on
 * bodyweight movements — and folding them in here would produce an inviting
 * patch that quietly skips those.
 *
 * A key present and `undefined` clears the field, as everywhere else.
 */
export type SessionText = Partial<Pick<Session, 'title' | 'notes'>>;

export async function updateSessionText(id: Id, patch: SessionText): Promise<Session> {
  return db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    // Merge aligned with `Table.update`, which is also what the shape guard
    // reconstructs before validating.
    const next = { ...session } as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      const value = patch[key as keyof SessionText];
      if (value === undefined) delete next[key];
      else next[key] = value;
    }

    await db.sessions.update(id, patch);
    return next as unknown as Session;
  });
}

/**
 * The note carried by one exercise *within* a session — "bench set too high",
 * "shoulder complained on the third set".
 *
 * It belongs to the block and not to the exercise: it is true of that day, not
 * of the movement. Passing `undefined` clears it.
 */
export async function setSessionExerciseNotes(
  id: Id,
  notes: string | undefined,
): Promise<SessionExercise> {
  return db.transaction('rw', db.sessionExercises, async () => {
    const block = await db.sessionExercises.get(id);
    if (!block) throw new Error(`Session exercise not found: ${id}`);

    await db.sessionExercises.update(id, { notes });

    const next = { ...block };
    if (notes === undefined) delete next.notes;
    else next.notes = notes;

    return next;
  });
}

/**
 * Records the bodyweight for a session, or clears it when passed `undefined`.
 *
 * Without it no progression is measurable on `bodyweight`,
 * `weighted_bodyweight` or `assisted` exercises: ten pull-ups four kilos
 * lighter is not the same performance, and nothing else in the model says so.
 *
 * Bounds are checked by the structural hook, as for any other session write.
 */
export async function setSessionBodyweight(
  id: Id,
  bodyweightKg: number | undefined,
): Promise<Session> {
  return db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error(`Session not found: ${id}`);

    // `undefined` deletes the property rather than storing an empty value.
    await db.sessions.update(id, { bodyweightKg });

    const next = { ...session };
    if (bodyweightKg === undefined) delete next.bodyweightKg;
    else next.bodyweightKg = bodyweightKg;

    return next;
  });
}

/** Deletes a session, its blocks and all its sets in a single transaction. */
export async function deleteSession(id: Id): Promise<void> {
  await db.transaction('rw', db.sessions, db.sessionExercises, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete();
    await db.sessionExercises.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Blocks (an exercise within a session)
// ---------------------------------------------------------------------------

/**
 * Adds an exercise to a session. The same exercise may appear twice (start and
 * end of a session is a common training pattern).
 *
 * Allowed on an already-closed session: fixing last night's omission is a
 * legitimate use.
 */
export async function addExerciseToSession(
  sessionId: Id,
  exerciseId: Id,
  options: { notes?: string } = {},
): Promise<SessionExercise> {
  return db.transaction('rw', db.sessionExercises, db.sessions, db.exercises, async () => {
    const [session, exercise] = await Promise.all([
      db.sessions.get(sessionId),
      db.exercises.get(exerciseId),
    ]);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (!exercise) throw new Error(`Exercise not found: ${exerciseId}`);

    assertExerciseSelectable(exercise);

    const last = await db.sessionExercises
      .where('[sessionId+order]')
      .between([sessionId, MIN_NUMBER_KEY], [sessionId, MAX_NUMBER_KEY])
      .reverse()
      .first();

    const block: SessionExercise = {
      id: newId(),
      sessionId,
      exerciseId,
      order: last ? last.order + 1 : 0,
      ...(options.notes !== undefined ? { notes: options.notes } : {}),
    };

    await db.sessionExercises.add(block);
    return block;
  });
}

/** A session's blocks, already sorted by the `[sessionId+order]` index. */
export async function listSessionExercises(sessionId: Id): Promise<SessionExercise[]> {
  return db.sessionExercises
    .where('[sessionId+order]')
    .between([sessionId, MIN_NUMBER_KEY], [sessionId, MAX_NUMBER_KEY])
    .toArray();
}

/**
 * Removes an exercise from a session.
 *
 * An empty block disappears without ceremony — it was a mis-tap. A block that
 * holds sets requires `force: true`: a one-handed typo between two sets must
 * not wipe four squat sets.
 *
 * @throws {SessionExerciseNotEmptyError} when sets exist and `force` is absent.
 */
export async function removeExerciseFromSession(
  sessionExerciseId: Id,
  options: { force?: boolean } = {},
): Promise<{ deletedSets: number }> {
  return db.transaction('rw', db.sessionExercises, db.sets, async () => {
    const block = await db.sessionExercises.get(sessionExerciseId);
    if (!block) throw new Error(`Session exercise not found: ${sessionExerciseId}`);

    const setCount = await db.sets
      .where('sessionExerciseId')
      .equals(sessionExerciseId)
      .count();

    if (setCount > 0 && !options.force) {
      throw new SessionExerciseNotEmptyError(sessionExerciseId, setCount);
    }

    await db.sets.where('sessionExerciseId').equals(sessionExerciseId).delete();
    await db.sessionExercises.delete(sessionExerciseId);

    return { deletedSets: setCount };
  });
}

/**
 * Joins an exercise to the one after it in a superset, or splits them apart.
 *
 * The only gesture offered, and that is deliberate: a superset built one
 * neighbour at a time can never have a hole in it, so contiguity is a property
 * of the model rather than a rule someone has to remember to check.
 *
 * Returns the session's blocks as they now stand. A block with no neighbour
 * after it changes nothing.
 */
export async function toggleSupersetWithNext(blockId: Id): Promise<SessionExercise[]> {
  return db.transaction('rw', db.sessionExercises, async () => {
    const block = await db.sessionExercises.get(blockId);
    if (!block) throw new Error(`Session exercise not found: ${blockId}`);

    const blocks = await listSessionExercises(block.sessionId);
    const changes = toggleJoinWithNext(blocks, blockId);
    if (changes === null) return blocks;

    await Promise.all(
      changes.map((change) =>
        db.sessionExercises.update(change.id, { supersetGroup: change.supersetGroup }),
      ),
    );

    return listSessionExercises(block.sessionId);
  });
}

/**
 * Reorders a session's exercises.
 *
 * `orderedIds` must describe **exactly** the session's blocks: a partial order
 * would leave inconsistent ranks. Unlike sets, ranks are renumbered 0…n-1 here —
 * this is an explicit gesture, and N is a handful.
 */
export async function reorderSessionExercises(
  sessionId: Id,
  orderedIds: Id[],
): Promise<SessionExercise[]> {
  return db.transaction('rw', db.sessionExercises, async () => {
    const blocks = await listSessionExercises(sessionId);
    const known = new Set(blocks.map((block) => block.id));

    const isExactCover =
      orderedIds.length === blocks.length &&
      new Set(orderedIds).size === orderedIds.length &&
      orderedIds.every((id) => known.has(id));

    if (!isExactCover) {
      throw new Error(
        `Invalid reorder: expected exactly the ${blocks.length} exercise(s) of ` +
          `session ${sessionId}, received ${orderedIds.length} identifier(s).`,
      );
    }

    await Promise.all(
      orderedIds.map((id, order) => db.sessionExercises.update(id, { order })),
    );

    return listSessionExercises(sessionId);
  });
}
