/**
 * The app's data model.
 *
 * Hierarchy:
 *   Exercise            the movement itself, reusable across sessions (catalogue)
 *   Session             one dated training session
 *   └─ SessionExercise  an exercise *within* a session (the "block"), holds order
 *      └─ SetEntry      one performed set: load / reps / time
 *
 * All loads are in **kilograms**, stored and displayed. The app is metric with
 * an optional pounds display, but kilograms remain the canonical unit: the unit
 * preference never rewrites a row.
 */

/** Opaque identifier (UUID v4). See `newId()` in `./keys`. */
export type Id = string;

/** Absolute instant, in milliseconds since the epoch (UTC). */
export type Timestamp = number;

/**
 * Local date as `YYYY-MM-DD`, the way the user perceives it.
 * Deliberately duplicates `Session.startedAt`: this is what groups sessions
 * ("my March sessions") with no timezone drift.
 */
export type LocalDate = string;

// ---------------------------------------------------------------------------
// Exercise
// ---------------------------------------------------------------------------

/**
 * Where the load comes from — determines how to read `SetEntry.weightKg` and
 * what the UI must ask for.
 */
export type LoadType =
  /** Barbell, dumbbells, machine. `weightKg` = the load lifted. */
  | 'external'
  /** Bodyweight alone (push-ups, pull-ups). `weightKg` absent. */
  | 'bodyweight'
  /** Bodyweight plus added load (belt). `weightKg` = the *added* load. */
  | 'weighted_bodyweight'
  /** Assisted machine / band. `weightKg` = the assistance *removed*. */
  | 'assisted';

/** What is counted to measure a set's effort. */
export type EffortMetric =
  /** Repetitions → `SetEntry.reps` required. */
  | 'reps'
  /** Duration (plank, dead hang) → `SetEntry.durationSec` required. */
  | 'time';

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'fullbody'
  | 'cardio';

/**
 * An exercise the user deleted from the catalogue.
 *
 * Kept as a tombstone, not out of tidiness: the seed backfill adds any shipped
 * exercise whose name is free, so without this the next catalogue update would
 * quietly hand back everything that was removed.
 */
export interface RetiredExercise {
  /** Normalised name — the exercise row itself is gone. */
  nameKey: string;
  retiredAt: Timestamp;
}

/**
 * The movement itself. A first-class entity: it is the keystone of progression
 * over time, so never a name copied into a set.
 */
export interface Exercise {
  id: Id;

  /** Display name, as typed. e.g. "Bench press". */
  name: string;
  /**
   * `name` normalised (lowercase, accents and punctuation removed, whitespace
   * collapsed). Unique in the database: prevents "Bench press" and "bench-press"
   * from becoming two separate histories.
   */
  nameKey: string;

  loadType: LoadType;
  metric: EffortMetric;

  /**
   * `true` when reps are counted per side (single-arm dumbbell work, lunges).
   * Settles the "10 reps: 10 or 20?" ambiguity when comparing two sessions.
   */
  perSide: boolean;

  muscleGroup?: MuscleGroup;

  /** Step for the UI's +/- buttons, in kg (2.5 for a bar, 1 for a cable). */
  defaultIncrementKg?: number;

  /** `false` = shipped with the app, `true` = created by the user. */
  isCustom: boolean;

  /**
   * Hidden from the picker without being deleted — the set history must stay
   * readable. A *date* field rather than a boolean: IndexedDB does not index
   * booleans.
   */
  archivedAt?: Timestamp;

  createdAt: Timestamp;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** One dated session. `endedAt` absent ⇒ still in progress. */
export interface Session {
  id: Id;

  startedAt: Timestamp;
  /** Absent until the session is closed. */
  endedAt?: Timestamp;

  /** Local day of `startedAt`, denormalised for grouping and the calendar. */
  date: LocalDate;

  /** e.g. "Push A". Optional: in the gym, nobody names their session. */
  title?: string;

  /**
   * @deprecated Bodyweight now lives in its own dated timeline — see
   * `BodyWeight`. Kept on the type because backups written before that change
   * still carry it, and importing one has to be able to read it. Nothing
   * writes it any more.
   */
  bodyweightKg?: number;

  notes?: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Bodyweight
// ---------------------------------------------------------------------------

/**
 * What you weighed on a given day.
 *
 * Its own entity, and keyed by the **day** rather than by an id, because that
 * is what it is: one weight per date, replaced rather than accumulated. It
 * used to hang off `Session`, which meant it could only be recorded on a day
 * you trained — and weighing yourself is a morning thing, not a between-sets
 * thing.
 *
 * A session reads the weight of its own day rather than storing a second copy.
 * Two places holding the same number is two places that will disagree the day
 * one of them is corrected.
 */
export interface BodyWeight {
  /** The day, `YYYY-MM-DD`. Primary key: one weight per day. */
  date: LocalDate;
  weightKg: number;
  /** When it was entered, which is not necessarily the day it describes. */
  recordedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Exercise within a session (the "block")
// ---------------------------------------------------------------------------

/**
 * Ties an exercise to a session and carries its rank. Exists independently of
 * any set: you add the exercise to the session *then* log the sets, which
 * matches the real gesture (phone in hand, between two sets).
 */
export interface SessionExercise {
  id: Id;
  sessionId: Id;
  exerciseId: Id;

  /** Rank within the session. Strictly increasing, not necessarily contiguous. */
  order: number;

  /**
   * Blocks sharing a number form a superset. Unused for now; the room is
   * reserved so the history never needs migrating later.
   */
  supersetGroup?: number;

  /** Notes for the day on this exercise ("bench too high", "shoulder ache"). */
  notes?: string;
}

// ---------------------------------------------------------------------------
// Set
// ---------------------------------------------------------------------------

export type SetKind =
  /** A set counted in progression and records. */
  | 'work'
  /**
   * Warm-up: excluded from charts and PRs. Without this distinction, ramping
   * loads bury the progression signal.
   */
  | 'warmup';

/**
 * One performed set. The measure fields are deliberately **flat and optional**
 * rather than a discriminated union: the parent `Exercise` says which ones are
 * relevant, and progression aggregates stay trivial to write.
 *
 * Invariants, enforced by `./validation` and `./sets`:
 *   metric 'reps' → `reps` set, `durationSec` absent
 *   metric 'time' → `durationSec` set, `reps` absent
 *   loadType 'bodyweight' → `weightKg` absent; otherwise `weightKg` set (≥ 0)
 */
export interface SetEntry {
  id: Id;

  /** The block this set belongs to. */
  sessionExerciseId: Id;

  /**
   * Denormalised from the parent block and session, purely to enable the
   * `[exerciseId+performedAt+order]` index (an exercise's history with no
   * join). Must be rewritten if the session's date changes.
   */
  sessionId: Id;
  exerciseId: Id;
  /** Copy of `Session.startedAt`. */
  performedAt: Timestamp;

  /**
   * The real instant the set was written, derived at creation.
   *
   * Distinct from `performedAt`, which is the *session's* time: this is the only
   * field saying when a set was actually logged. It allows closing a forgotten
   * session honestly, back at its last set rather than at "now".
   */
  loggedAt: Timestamp;

  /**
   * Rank within the block. Strictly increasing, not necessarily contiguous:
   * deleting a set does not force renumbering the rest. The "Set 1, 2, 3"
   * display uses the array index, not this field.
   */
  order: number;

  kind: SetKind;

  /** Load in kg. Meaning determined by `Exercise.loadType`. */
  weightKg?: number;
  /** Reps. Per side when `Exercise.perSide`. */
  reps?: number;
  /** Duration in seconds, for timed exercises. */
  durationSec?: number;

  /** Rate of perceived exertion, 1–10. */
  rpe?: number;
  /** Set taken to muscular failure. */
  isFailure?: boolean;

  notes?: string;
}

// ---------------------------------------------------------------------------
// Assembled views (never persisted)
// ---------------------------------------------------------------------------

/** A block resolved with its exercise and its sorted sets. */
export interface SessionExerciseWithSets extends SessionExercise {
  exercise: Exercise;
  sets: SetEntry[];
}

/** A complete session, ready to display. */
export interface SessionDetail extends Session {
  entries: SessionExerciseWithSets[];
}

/**
 * A row of the history list.
 *
 * Contains **only** what can be obtained without reading any set: the session's
 * own fields, its blocks (a few tiny rows) and an index count. Total volume
 * (Σ load × reps) is deliberately absent — it is the one figure that would
 * force loading every set of every session.
 */
export interface SessionSummary {
  id: Id;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  date: LocalDate;
  title?: string;

  /** Duration in milliseconds. Absent until the session is closed. */
  durationMs?: number;

  /** Number of blocks. Always equal to `exerciseNames.length`. */
  exerciseCount: number;

  /**
   * Each block's name, in session order. An exercise done twice appears twice:
   * this is a faithful projection, and de-duplicating is a display choice.
   */
  exerciseNames: string[];

  /**
   * All sets, warm-ups included. Counting work sets only would require reading
   * every record — `kind` is not indexed — which is exactly what this summary
   * avoids.
   */
  setCount: number;
}
