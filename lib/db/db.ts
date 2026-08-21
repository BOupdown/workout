import Dexie, { type Table } from 'dexie';
import { toNameKey } from './keys';
import { buildSeedExercises, CATALOGUE_RENAMES } from './seed';
import type { BodyWeight, Exercise, Session, SessionExercise, SetEntry } from './types';
import type { TrainingBlock } from '../training-block';
import {
  assertBodyWeightShape,
  assertExerciseShape,
  assertTrainingBlockShape,
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
  // Keyed by `LocalDate`, not by an id: one weight per day.
  bodyweights!: Table<BodyWeight, string>;
  trainingBlocks!: Table<TrainingBlock, string>;

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

    /**
     * Bodyweight moves out of `Session` and into its own dated timeline.
     *
     * It hung off the session because that is where it was entered, which had
     * the effect of making it impossible to weigh yourself on a rest day. The
     * weight of a day is a fact about the day, not about the training.
     *
     * Existing values are carried across and then removed from the sessions,
     * rather than left behind: a second copy nobody reads is a second copy
     * somebody will eventually read by mistake. The whole thing runs in the
     * upgrade transaction, so it either lands completely or not at all.
     *
     * Where two sessions share a day — rare, but the model allows it — the
     * later one wins, since it was weighed last.
     */
    this.version(3)
      .stores({ bodyweights: 'date' })
      .upgrade(async (transaction) => {
        const sessions = transaction.table<Session, string>('sessions');
        const bodyweights = transaction.table<BodyWeight, string>('bodyweights');

        const withWeight = await sessions
          .filter((session) => session.bodyweightKg !== undefined)
          .toArray();

        const byDate = new Map<string, Session>();
        for (const session of withWeight) {
          const seen = byDate.get(session.date);
          if (!seen || session.startedAt > seen.startedAt) byDate.set(session.date, session);
        }

        await bodyweights.bulkPut(
          [...byDate.values()].map((session) => ({
            date: session.date,
            weightKg: session.bodyweightKg as number,
            recordedAt: session.startedAt,
          })),
        );

        for (const session of withWeight) {
          await sessions.update(session.id, { bodyweightKg: undefined });
        }
      });


    /**
     * Training blocks — a stretch of weeks with one intent.
     *
     * `startsOn` is indexed because every read is "which block covers this
     * day", which is a scan backwards from a date. There is nothing to migrate:
     * the table simply did not exist before, and an app with no blocks behaves
     * exactly as it did.
     */
    this.version(4).stores({ trainingBlocks: 'id, startsOn' });

    /**
     * Blocks gain an end date.
     *
     * Version 4 was never released, so this touches no real data — it exists
     * so a development database opens cleanly rather than carrying blocks with
     * no end, which every read would then have to defend against. Inventing an
     * end for them would be a guess dressed as a fact.
     */
    this.version(5).upgrade(async (transaction) => {
      const blocks = transaction.table<TrainingBlock, string>('trainingBlocks');
      const orphans = await blocks.filter((block) => block.endsOn === undefined).toArray();
      await Promise.all(orphans.map((block) => blocks.delete(block.id)));
    });

    /**
     * Catalogue additions reach databases that already exist.
     *
     * `on('populate')` fires once, when a database is created, so everything
     * added to the seed after that would only ever appear on new installs —
     * which is to say, not on the phone of anyone already using the app.
     *
     * Anything whose normalised name is already taken is skipped, whoever owns
     * it. A user who created their own "Front squat" keeps theirs, with its
     * history: `&nameKey` is unique, and overwriting it would be both a lost
     * exercise and an aborted upgrade. That also makes this safe to re-run.
     */
    this.version(6).upgrade(async (transaction) => {
      const exercises = transaction.table<Exercise, string>('exercises');

      for (const candidate of buildSeedExercises()) {
        const taken = await exercises.where('nameKey').equals(candidate.nameKey).first();
        if (taken) continue;

        await exercises.add(candidate);
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
    installShapeGuard(this.bodyweights, assertBodyWeightShape);
    installShapeGuard(this.trainingBlocks, assertTrainingBlockShape);
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
