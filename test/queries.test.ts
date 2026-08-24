import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { archiveExercise } from '../lib/db/exercises';
import { getSessionDetail, listSessionSummaries } from '../lib/db/queries';
import { createSet } from '../lib/db/sets';
import {
  addExerciseToSession,
  endSession,
  removeExerciseFromSession,
  reorderSessionExercises,
  startSession,
} from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank } = await referenceExercises());
});

/** A complete session: squat (warm-up + 2 sets), pushUps (1), plank (1). */
async function buildFullSession(startedAt = new Date(2026, 7, 16, 19, 0).getTime()) {
  const { session } = await startSession({ startedAt, title: 'Full body' });

  const squatBlock = await addExerciseToSession(session.id, squat.id);
  const pompesBlock = await addExerciseToSession(session.id, pushUps.id);
  const gainageBlock = await addExerciseToSession(session.id, plank.id);

  await createSet({ sessionExerciseId: squatBlock.id, kind: 'warmup', weightKg: 40, reps: 10 });
  await createSet({ sessionExerciseId: squatBlock.id, weightKg: 100, reps: 5 });
  await createSet({ sessionExerciseId: squatBlock.id, weightKg: 100, reps: 5 });
  await createSet({ sessionExerciseId: pompesBlock.id, reps: 25 });
  await createSet({ sessionExerciseId: gainageBlock.id, durationSec: 90 });

  return { session, squatBlock, pompesBlock, gainageBlock };
}

describe('getSessionDetail', () => {
  it('returns nothing for a session it does not know', async () => {
    expect(await getSessionDetail('inconnue')).toBeUndefined();
  });

  it('carries over the fields the session owns', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.id).toBe(session.id);
    expect(detail.date).toBe('2026-08-16');
    expect(detail.title).toBe('Full body');
    expect(detail.startedAt).toBe(session.startedAt);
  });

  it('returns the blocks in session order', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries.map((e) => e.exercise.name)).toEqual(['Squat', 'Push-ups', 'Plank']);
    expect(detail.entries.map((e) => e.order)).toEqual([0, 1, 2]);
  });

  it('resolves the exercise of every block', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries[0].exercise.id).toBe(squat.id);
    expect(detail.entries[0].exercise.loadType).toBe('external');
    expect(detail.entries[2].exercise.metric).toBe('time');
  });

  it('attaches every set to its block, sorted by order', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries.map((e) => e.sets.length)).toEqual([3, 1, 1]);
    expect(detail.entries[0].sets.map((s) => s.order)).toEqual([0, 1, 2]);
    expect(detail.entries[0].sets.map((s) => s.weightKg)).toEqual([40, 100, 100]);
  });

  it('keeps the warm-ups', async () => {
    const { session } = await buildFullSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries[0].sets.map((s) => s.kind)).toEqual(['warmup', 'work', 'work']);
  });

  it('returns a block with no set holding an empty list', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.entries).toHaveLength(1);
    expect(detail.entries[0].sets).toEqual([]);
  });

  it('returns an empty session with no block', async () => {
    const { session } = await startSession();
    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries).toEqual([]);
  });

  it('tells two blocks of the same exercise apart', async () => {
    const { session } = await startSession();
    const first = await addExerciseToSession(session.id, squat.id);
    const second = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: first.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: second.id, weightKg: 60, reps: 12 });

    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0].id).toBe(first.id);
    expect(detail.entries[0].sets[0].weightKg).toBe(100);
    expect(detail.entries[1].sets[0].weightKg).toBe(60);
  });

  it('borrows no set from another session', async () => {
    const first = await buildFullSession(new Date(2026, 7, 9, 19, 0).getTime());
    const second = await buildFullSession(new Date(2026, 7, 16, 19, 0).getTime());

    const detail = (await getSessionDetail(second.session.id))!;
    const ids = detail.entries.flatMap((e) => e.sets.map((s) => s.sessionId));

    expect(new Set(ids)).toEqual(new Set([second.session.id]));
    expect(detail.entries.flatMap((e) => e.sets)).toHaveLength(5);
    expect(first.session.id).not.toBe(second.session.id);
  });

  it('reflects a reordering of the blocks', async () => {
    const { session, squatBlock, pompesBlock, gainageBlock } = await buildFullSession();
    await reorderSessionExercises(session.id, [gainageBlock.id, squatBlock.id, pompesBlock.id]);

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.entries.map((e) => e.exercise.name)).toEqual(['Plank', 'Squat', 'Push-ups']);
  });

  it('reflects a block being removed', async () => {
    const { session, pompesBlock } = await buildFullSession();
    await removeExerciseFromSession(pompesBlock.id, { force: true });

    const detail = (await getSessionDetail(session.id))!;
    expect(detail.entries.map((e) => e.exercise.name)).toEqual(['Squat', 'Plank']);
    expect(detail.entries.flatMap((e) => e.sets)).toHaveLength(4);
  });

  it('returns an archived exercise as usual', async () => {
    // The point of the decision: archiving only concerns the picker. Filtering
    // here would make a block vanish from a past session while its sets are
    // still there.
    const { session } = await buildFullSession();
    await archiveExercise(squat.id);

    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries.map((e) => e.exercise.name)).toContain('Squat');
    expect(detail.entries[0].exercise.archivedAt).toBeDefined();
    expect(detail.entries[0].sets).toHaveLength(3);
  });

  it('names the hole rather than refusing the whole session', async () => {
    // This assertion used to expect an exception. It took the session screen
    // *and* the whole history down with it — see `placeholderExercise`.
    const { session } = await buildFullSession();
    await db.exercises.delete(squat.id);

    const detail = (await getSessionDetail(session.id))!;

    expect(detail.entries[0].exercise.name).toBe('Missing exercise');
    expect(detail.entries[0].sets).toHaveLength(3);
    // The other blocks are untouched.
    expect(detail.entries.map((e) => e.exercise.name)).toContain('Push-ups');
  });
});

describe('listSessionSummaries', () => {
  it('returns nothing from an empty database', async () => {
    expect(await listSessionSummaries()).toEqual([]);
  });

  it('sorts from the most recent to the oldest', async () => {
    await buildFullSession(new Date(2026, 7, 2, 19, 0).getTime());
    await buildFullSession(new Date(2026, 7, 9, 19, 0).getTime());
    await buildFullSession(new Date(2026, 7, 16, 19, 0).getTime());

    const summaries = await listSessionSummaries();
    expect(summaries.map((s) => s.date)).toEqual(['2026-08-16', '2026-08-09', '2026-08-02']);
  });

  it('counts blocks and sets without getting it wrong', async () => {
    await buildFullSession();
    const [summary] = await listSessionSummaries();

    expect(summary.exerciseCount).toBe(3);
    // Warm-up included: 3 squat sets, 1 of pushUps, 1 of plank.
    expect(summary.setCount).toBe(5);
  });

  it('lists the exercise names in session order', async () => {
    await buildFullSession();
    const [summary] = await listSessionSummaries();

    expect(summary.exerciseNames).toEqual(['Squat', 'Push-ups', 'Plank']);
  });

  it('keeps exerciseNames aligned with exerciseCount, duplicates included', async () => {
    const { session } = await startSession();
    await addExerciseToSession(session.id, squat.id);
    await addExerciseToSession(session.id, pushUps.id);
    await addExerciseToSession(session.id, squat.id);

    const [summary] = await listSessionSummaries();

    expect(summary.exerciseNames).toEqual(['Squat', 'Push-ups', 'Squat']);
    expect(summary.exerciseCount).toBe(summary.exerciseNames.length);
  });

  it('handles a session holding no block at all', async () => {
    await startSession();
    const [summary] = await listSessionSummaries();

    expect(summary.exerciseCount).toBe(0);
    expect(summary.exerciseNames).toEqual([]);
    expect(summary.setCount).toBe(0);
  });

  it('does not count the sets of other sessions', async () => {
    await buildFullSession(new Date(2026, 7, 9, 19, 0).getTime());
    const { session } = await startSession({ startedAt: new Date(2026, 7, 16, 19, 0).getTime() });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const summaries = await listSessionSummaries();
    expect(summaries[0].setCount).toBe(1);
    expect(summaries[1].setCount).toBe(5);
  });

  it('stays correct on a large session', async () => {
    // Checks that the indexed count gives the same answer as reading
    // everything, at a volume where the difference in cost really tells.
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    for (let i = 0; i < 80; i++) {
      await createSet({ sessionExerciseId: block.id, weightKg: 60, reps: 5 });
    }

    const [summary] = await listSessionSummaries();
    expect(summary.setCount).toBe(80);
    expect(summary.exerciseCount).toBe(1);
  });

  it('carries the title over where there is one', async () => {
    await buildFullSession();
    await startSession({ startedAt: new Date(2026, 7, 17, 19, 0).getTime() });

    const summaries = await listSessionSummaries();
    expect('title' in summaries[0]).toBe(false);
    expect(summaries[1].title).toBe('Full body');
  });

  it('works out the duration of a closed session', async () => {
    const startedAt = new Date(2026, 7, 16, 19, 0).getTime();
    const { session } = await startSession({ startedAt });
    await endSession(session.id, startedAt + 4_500_000);

    const [summary] = await listSessionSummaries();
    expect(summary.endedAt).toBe(startedAt + 4_500_000);
    expect(summary.durationMs).toBe(4_500_000);
  });

  it('leaves the duration absent while the session is running', async () => {
    await startSession();
    const [summary] = await listSessionSummaries();

    expect(summary.endedAt).toBeUndefined();
    expect('durationMs' in summary).toBe(false);
  });

  it('names an archived exercise as usual', async () => {
    await buildFullSession();
    await archiveExercise(squat.id);

    const [summary] = await listSessionSummaries();
    expect(summary.exerciseNames).toContain('Squat');
  });
});

describe('listSessionSummaries — pagination', () => {
  const dates = [2, 9, 16, 23, 30];

  beforeEach(async () => {
    for (const day of dates) {
      await startSession({ startedAt: new Date(2026, 7, day, 19, 0).getTime() });
    }
  });

  it('respects the limit it was asked for', async () => {
    expect(await listSessionSummaries({ limit: 2 })).toHaveLength(2);
  });

  it('walks the pages with no overlap and no hole', async () => {
    const first = await listSessionSummaries({ limit: 2 });
    const second = await listSessionSummaries({ limit: 2, before: first[1].startedAt });
    const third = await listSessionSummaries({ limit: 2, before: second[1].startedAt });

    const ids = [...first, ...second, ...third].map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
    expect(third).toHaveLength(1);

    const all = await listSessionSummaries();
    expect(ids).toEqual(all.map((s) => s.id));
  });

  it('exclut strictement le curseur', async () => {
    const all = await listSessionSummaries();
    const page = await listSessionSummaries({ before: all[0].startedAt });

    expect(page.map((s) => s.id)).not.toContain(all[0].id);
    expect(page).toHaveLength(4);
  });

  it('returns an empty page past the oldest one', async () => {
    const all = await listSessionSummaries();
    const beyond = await listSessionSummaries({ before: all[all.length - 1].startedAt });

    expect(beyond).toEqual([]);
  });
});

describe('a reference that no longer resolves', () => {
  /**
   * The state only arrives through a damaged database — a restored backup with
   * a row missing. What matters is what the app does with it: throwing took the
   * session screen *and* the whole history down, intact sessions included,
   * leaving nothing left to export.
   */
  async function danglingBlock() {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });
    // Straight into the table: no write path produces this.
    await db.exercises.delete(squat.id);
    return session;
  }

  it('leaves the session readable, and the hole named', async () => {
    const session = await danglingBlock();
    const detail = await getSessionDetail(session.id);

    expect(detail?.entries).toHaveLength(1);
    expect(detail?.entries[0].exercise.name).toBe('Missing exercise');
    expect(detail?.entries[0].sets).toHaveLength(1);
  });

  it('laisse l’historique entier lisible', async () => {
    await danglingBlock();
    const summaries = await listSessionSummaries();

    expect(summaries).toHaveLength(1);
    expect(summaries[0].setCount).toBe(1);
    expect(summaries[0].exerciseNames).toEqual(['Missing exercise']);
  });
});
