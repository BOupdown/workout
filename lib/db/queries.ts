/**
 * Assembled reads, cutting across entities.
 *
 * Two projections, no writes:
 *   getSessionDetail()      one complete session, for the session screen
 *   listSessionSummaries()  the history list, paginated and light
 *
 * A rule they share: **neither read filters on `archivedAt`**. Archiving only
 * concerns picking an exercise; filtering here would make a block vanish from a
 * past session while its sets still exist. Exercises are therefore resolved by
 * `bulkGet` on ids, never through a filtered list.
 */

import { db } from './db';
import { listSessionExercises } from './sessions';
import type {
  Exercise,
  Id,
  SessionDetail,
  SessionExercise,
  SessionExerciseWithSets,
  SessionSummary,
  SetEntry,
  LocalDate,
  Timestamp,
} from './types';

/**
 * A block points at an exercise that no longer exists. No write path can
 * produce this state — there is no exercise deletion — so we fail loudly rather
 * than quietly drop an exercise from the history.
 */
function missingExercise(block: SessionExercise): Error {
  return new Error(
    `Exercise ${block.exerciseId} not found, referenced by block ${block.id}. ` +
      'Inconsistent database.',
  );
}

/** Index of the exercises named by a list of blocks, in a single query. */
async function loadExercisesFor(blocks: SessionExercise[]): Promise<Map<Id, Exercise>> {
  const ids = [...new Set(blocks.map((block) => block.exerciseId))];
  const exercises = await db.exercises.bulkGet(ids);

  const byId = new Map<Id, Exercise>();
  for (const exercise of exercises) {
    if (exercise) byId.set(exercise.id, exercise);
  }
  return byId;
}

/**
 * A session, its blocks, their exercises and their sets.
 *
 * Four indexed queries whatever the number of blocks: the session, its blocks, a
 * `bulkGet` of the de-duplicated exercises, and **one** range over the session's
 * sets — no per-block query. Grouping happens in memory.
 *
 * All inside a read transaction, so blocks and sets come from the same snapshot:
 * without it, a set written between the two queries would give an inconsistent
 * view.
 */
export async function getSessionDetail(sessionId: Id): Promise<SessionDetail | undefined> {
  return db.transaction(
    'r',
    db.sessions,
    db.sessionExercises,
    db.sets,
    db.exercises,
    async () => {
      const session = await db.sessions.get(sessionId);
      if (!session) return undefined;

      // Already sorted by the `[sessionId+order]` index.
      const blocks = await listSessionExercises(sessionId);

      const [exerciseById, sets] = await Promise.all([
        loadExercisesFor(blocks),
        // Sorted globally by `order`, so each group is built in the right order
        // as it fills, with no per-block re-sort.
        db.sets.where('sessionId').equals(sessionId).sortBy('order'),
      ]);

      const setsByBlock = new Map<Id, SetEntry[]>();
      for (const set of sets) {
        const bucket = setsByBlock.get(set.sessionExerciseId);
        if (bucket) bucket.push(set);
        else setsByBlock.set(set.sessionExerciseId, [set]);
      }

      const entries: SessionExerciseWithSets[] = blocks.map((block) => {
        const exercise = exerciseById.get(block.exerciseId);
        if (!exercise) throw missingExercise(block);

        return {
          ...block,
          exercise,
          sets: setsByBlock.get(block.id) ?? [],
        };
      });

      return { ...session, entries };
    },
  );
}

export interface SessionHistoryPage {
  /** How many sessions to return. */
  limit?: number;
  /**
   * Cursor: return only sessions **strictly earlier** than this instant. Pass
   * the `startedAt` of the last row shown to fetch the next page with no
   * overlap.
   */
  before?: Timestamp;
}

/**
 * How many sessions fall on each day of a range.
 *
 * An indexed range over `date`, which is exactly what that index was declared
 * for. A whole calendar month is one scan of a handful of rows, and the map is
 * keyed the same way the grid is, so the screen looks a day up rather than
 * filtering a list per cell.
 */
export async function countSessionsByDate(
  from: LocalDate,
  to: LocalDate,
): Promise<Map<LocalDate, number>> {
  const sessions = await db.sessions.where('date').between(from, to, true, true).toArray();

  const byDate = new Map<LocalDate, number>();
  for (const session of sessions) {
    byDate.set(session.date, (byDate.get(session.date) ?? 0) + 1);
  }
  return byDate;
}

/**
 * How many sessions were recorded since a given instant, or in total when
 * given `null`.
 *
 * An indexed count on `startedAt`: no session row is read, which is what makes
 * it cheap enough to sit behind a live query on the home screen.
 */
export async function countSessionsSince(since: Timestamp | null): Promise<number> {
  if (since === null) return db.sessions.count();
  return db.sessions.where('startedAt').above(since).count();
}

/**
 * History list, most recent first.
 *
 * A page's cost does **not** depend on how many sets its sessions hold: counting
 * goes through `count()` over an index range, which tallies index entries
 * without loading records. A 40-set session costs the same as a 5-set one.
 *
 * Total volume is deliberately absent from `SessionSummary`: it is the one
 * figure that would break that property. Should it become necessary, it must be
 * computed for the displayed page only — and certainly not denormalised as an
 * aggregate on `Session`, which would drift on every set write.
 */
export async function listSessionSummaries(
  options: SessionHistoryPage = {},
): Promise<SessionSummary[]> {
  const { limit = 20, before } = options;

  return db.transaction(
    'r',
    db.sessions,
    db.sessionExercises,
    db.sets,
    db.exercises,
    async () => {
      // `below(Infinity)` unifies both cases: `startedAt` is always a finite
      // number, so the default bound excludes nothing.
      const sessions = await db.sessions
        .where('startedAt')
        .below(before ?? Infinity)
        .reverse()
        .limit(limit)
        .toArray();

      if (sessions.length === 0) return [];

      const blocksBySession = new Map<Id, SessionExercise[]>();
      await Promise.all(
        sessions.map(async (session) => {
          blocksBySession.set(session.id, await listSessionExercises(session.id));
        }),
      );

      const allBlocks = [...blocksBySession.values()].flat();
      const [exerciseById, setCounts] = await Promise.all([
        loadExercisesFor(allBlocks),
        // One indexed `count()` per session — no set record is ever read.
        Promise.all(
          sessions.map((session) => db.sets.where('sessionId').equals(session.id).count()),
        ),
      ]);

      return sessions.map((session, index) => {
        const blocks = blocksBySession.get(session.id) ?? [];

        const exerciseNames = blocks.map((block) => {
          const exercise = exerciseById.get(block.exerciseId);
          if (!exercise) throw missingExercise(block);
          return exercise.name;
        });

        return {
          id: session.id,
          startedAt: session.startedAt,
          date: session.date,
          exerciseCount: blocks.length,
          exerciseNames,
          setCount: setCounts[index],
          ...(session.title !== undefined ? { title: session.title } : {}),
          ...(session.endedAt !== undefined
            ? { endedAt: session.endedAt, durationMs: session.endedAt - session.startedAt }
            : {}),
        };
      });
    },
  );
}
