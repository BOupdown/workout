import Dexie, { type Table } from 'dexie';
import { toNameKey } from './keys';
import { buildSeedExercises, CATALOGUE_RENAMES } from './seed';
import type { Exercise, Session, SessionExercise, SetEntry } from './types';
import {
  assertExerciseShape,
  assertSessionExerciseShape,
  assertSessionShape,
  assertSetShape,
} from './validation';

/**
 * The app's IndexedDB database.
 *
 * ⚠️ **Client-only module**: import it from `'use client'` components only.
 * `indexedDB` does not exist on the server.
 *
 * IndexedDB facts that explain the shape of the schema below:
 *   • a boolean is not a valid key → `archivedAt?: number`, `kind: string`
 *   • `undefined` is never indexed → a row whose indexed field is absent is
 *     *invisible* in that index (hence no index on `endedAt`)
 *   • a compound index can only be queried by prefix, in declaration order
 */
export class WorkoutDB extends Dexie {
  // `Table` rather than `EntityTable`: ids come from `newId()`, they are not
  // auto-generated, so `add()` must require them.
  exercises!: Table<Exercise, string>;
  sessions!: Table<Session, string>;
  sessionExercises!: Table<SessionExercise, string>;
  sets!: Table<SetEntry, string>;

  constructor() {
    super('workout');

    this.version(1).stores({
      // `&nameKey`: uniqueness of the normalised name, the guard against
      // duplicate exercises that would fragment a movement's history.
      // `archivedAt`: only archived rows appear there (undefined is not
      // indexed), which makes the index itself the archive list.
      exercises: 'id, &nameKey, name, muscleGroup, archivedAt',

      // `startedAt`: reverse-chronological list, and resuming the session in
      // progress (last row, then test `endedAt` in memory).
      // `date`: grouping by day, with no timezone drift.
      sessions: 'id, startedAt, date',

      // `[sessionId+order]`: rendering a session, blocks already sorted.
      // `exerciseId`: "which sessions included this exercise?".
      sessionExercises: 'id, sessionId, exerciseId, [sessionId+order]',

      // `[sessionExerciseId+order]`: a block's sets, already sorted.
      //
      // `[exerciseId+performedAt+order]`: the index the whole progression
      // feature rests on. "My last 5 squat sets" =
      //
      //   db.sets
      //     .where('[exerciseId+performedAt+order]')
      //     .between([squatId, -Infinity, -Infinity], [squatId, Infinity, Infinity])
      //     .reverse()
      //     .limit(5)
      //     .toArray()
      //
      // (explicit numeric bounds rather than `Dexie.maxKey`: see the comment on
      // `MIN_NUMBER_KEY` in `./sets`)
      //
      // → O(log n) plus 5 reads, no join with `sessions`, and ordering within a
      // session is exact thanks to `order` in third position. Filtering `kind`
      // ('work' vs 'warmup') happens in memory over that tiny tail rather than
      // through one more index to maintain on every write.
      //
      // `sessionId`: cascading delete of a session.
      sets: 'id, sessionId, sessionExerciseId, [sessionExerciseId+order], [exerciseId+performedAt+order]',
    });

    /**
     * Databases seeded while the app was in French keep their French exercise
     * names: the catalogue is **data**, not interface, so translating the seed
     * file alone would leave existing devices untouched.
     *
     * Only shipped exercises are renamed; anything the user created is left
     * alone. A rename is skipped when its target name is already taken, since
     * `&nameKey` is unique and a collision would abort the upgrade and leave
     * the database unopenable.
     */
    this.version(2).upgrade(async (transaction) => {
      const exercises = transaction.table<Exercise, string>('exercises');

      for (const [previousKey, englishName] of Object.entries(CATALOGUE_RENAMES)) {
        const existing = await exercises.where('nameKey').equals(previousKey).first();
        if (!existing || existing.isCustom) continue;

        const nameKey = toNameKey(englishName);
        const taken = await exercises.where('nameKey').equals(nameKey).first();
        if (taken) continue;

        await exercises.update(existing.id, { name: englishName, nameKey });
      }
    });

    // Starting catalogue, once, when the database is created.
    this.on('populate', (transaction) => {
      transaction.table<Exercise, string>('exercises').bulkAdd(buildSeedExercises());
    });

    // Last line of defence on structural invariants. Dexie hooks are
    // **synchronous**: they can only check what needs no read (types, bounds,
    // enumerations, consistency between two fields of the same row).
    // Invariants that depend on another entity — whether a load is expected for
    // a given exercise, an archived exercise, editing an exercise already in
    // use — live in `./sets` and `./sessions`, which can read inside the
    // transaction.
    //
    // Throwing here aborts the transaction: nothing is written by halves.
    installShapeGuard(this.exercises, assertExerciseShape);
    installShapeGuard(this.sets, assertSetShape);
    installShapeGuard(this.sessions, assertSessionShape);
    installShapeGuard(this.sessionExercises, assertSessionExerciseShape);
  }
}

/**
 * Attaches a structural validator to a table's writes.
 *
 * The `updating` hook receives property paths; the model being entirely flat, a
 * shallow merge faithfully reconstitutes the resulting row (a key present and
 * `undefined` means deletion, exactly as for `Table.update`).
 */
function installShapeGuard<T>(table: Table<T, string>, assertShape: (value: unknown) => void) {
  table.hook('creating', (_primaryKey, entity) => {
    assertShape(entity);
  });

  table.hook('updating', (modifications, _primaryKey, entity) => {
    assertShape({ ...entity, ...modifications });
  });
}

export const db = new WorkoutDB();

export { newId, toNameKey } from './keys';
